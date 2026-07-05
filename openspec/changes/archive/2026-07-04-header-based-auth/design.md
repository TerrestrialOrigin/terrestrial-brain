# Design: header-based-auth

## Context

The entire system is protected by one shared secret, `MCP_ACCESS_KEY`, checked at the edge function (`supabase/functions/terrestrial-brain-mcp/index.ts:60-65`). Today:

- The server accepts the key from an `x-brain-key` header **or** a `?key=` query param, and compares with `!==` — a non-constant-time comparison on the only secret in the system (timing side channel, finding S4/X4).
- The Obsidian plugin never uses the header path. The settings tab tells the user to paste the endpoint URL *including* `?key=` (`main.ts:664-667`), and `buildEndpointUrl` (`main.ts:771-779`) forwards that query string onto every request — so the key rides in URLs through edge/proxy logs and any intermediary.
- The plugin accepts any URL scheme without comment; a plain `http://` endpoint sends notes + key in cleartext.
- README line 50 claims "Row-Level Security with access-key authentication", overselling the model; RLS's actual role is anon-key lockout (finding S5), which Step 1 (`fix-db-security-policies`) already enforced at the DB layer.

Constraints: existing deployments (Claude Desktop/claude.ai MCP client configs, older plugin installs) use `?key=` URLs and must keep working; the MCP client config (README:271-306) embeds the key in the URL because MCP clients can't always set custom headers — so the query-param fallback cannot be removed, only deprecated.

## Goals / Non-Goals

**Goals:**
- Constant-time key verification on the server.
- Plugin sends the key exclusively via `x-brain-key`; the key disappears from plugin-constructed URLs.
- Zero-touch migration for existing plugin installs (`?key=` in stored URL → extracted to a dedicated setting).
- User is warned when the endpoint is not HTTPS (localhost excepted).
- README states the real trust model.

**Non-Goals:**
- Removing the `?key=` server fallback (MCP client configs still need it).
- Multi-user auth, key rotation, per-client keys.
- Encrypting the key at rest in Obsidian's `data.json` (standard Obsidian practice; stays documented as a known limitation in README).
- Plugin modularization (Step 21) — all edits stay within the current `main.ts` layout.
- Migrating the Deno integration-test files off `?key=` URLs wholesale — that's Step 5's helper extraction; this change only *adds* auth-focused tests.

## Decisions

### D1: Constant-time comparison via SHA-256 digest + XOR fold
`crypto.subtle` in the Supabase edge runtime has no `timingSafeEqual`. Instead, hash both the provided and expected keys with SHA-256 and compare the fixed-length digests with a branch-free XOR loop:

```ts
async function accessKeyMatches(providedKey: string, expectedKey: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(providedKey)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedKey)),
  ]);
  const providedBytes = new Uint8Array(providedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index++) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}
```

Hashing first also removes the length side channel (digests are always 32 bytes) and avoids branching on input length. Alternatives considered: a raw byte-by-byte constant-time loop over the strings (leaks length, needs careful padding); Node's `timingSafeEqual` via `node:crypto` compat (works in Deno but adds a Node-compat dependency for one call; the WebCrypto approach is runtime-native).

### D2: Header primary, query param deprecated-but-working
Server keeps `c.req.header("x-brain-key") || url.searchParams.get("key")` precedence exactly as today; only the comparison changes. README marks `?key=` as deprecated and explains it exists for MCP clients that cannot set headers. Alternative — hard-removing `?key=` — rejected: it would instantly break every existing MCP client config and any not-yet-updated plugin install.

### D3: Dedicated `accessKey` plugin setting; URL is stored key-free
`TBPluginSettings` gains `accessKey: string` (default `""`). `callHTTP` and `callIngestNote` send `"x-brain-key": accessKey` whenever it is non-empty. `buildEndpointUrl` keeps its current query-string-preserving behavior (harmless generality, already tested) — but after migration the stored URL simply has no query string. Alternative — parsing the key out of the URL at request time — rejected: it perpetuates key-in-URL storage and makes the settings UI lie about where the key lives.

### D4: Settings migration in `loadSettings`, mirroring the existing `debounceMs` migration pattern
On load, if the stored `tbEndpointUrl` contains a `key` query parameter:
1. If `accessKey` is empty, move the param's value into `accessKey`.
2. Strip the `key` parameter from the URL (removing the `?` entirely if no other params remain).
3. Persist via the normal save path.

The same extraction runs in the settings-tab URL `onChange`, so a user who pastes a fresh `?key=` URL (old habit, old docs, old MCP config copy-paste) gets the key auto-moved into the key field instead of silently double-sent. This follows the file's existing migration precedent (`debounceMs`/`pollIntervalMs`, `main.ts:462-472`).

### D5: HTTPS warning is a rendered settings-tab notice, not a hard block
The settings tab shows a warning element (`⚠️ … cleartext …`) beneath the endpoint field whenever the URL starts with `http://` and the host is not `localhost` or `127.0.0.1`. Plain-HTTP is still allowed — blocking it would break LAN/self-hosted setups — but the user can no longer end up on cleartext unknowingly. Helper `isInsecureEndpoint(url): boolean` is exported for unit testing. Alternative — a one-time `Notice` popup — rejected: transient, and invisible when settings are edited programmatically.

### D6: README trust-model section replaces the RLS overstatement
Line 50's "Row-Level Security with access-key authentication" becomes an accurate security-model paragraph: single shared secret enforced at the edge function; the edge function uses the service-role key internally; RLS's role is to lock out the anon key entirely (enforced by Step 1's migration); `x-brain-key` is the supported mechanism and `?key=` is deprecated (kept for MCP clients that cannot set headers). Troubleshooting/setup text that references `?key=` for the *plugin* is updated to the two-field settings flow.

## User Error Scenarios

| Mistake | Handling |
|---|---|
| Pastes endpoint URL still containing `?key=...` (old docs habit) | `onChange` + `loadSettings` extraction moves the key into the Access Key field and strips it from the URL; no double-send, no silent breakage |
| Pastes URL with `?key=` while Access Key field already filled | URL is stripped; existing `accessKey` is kept (explicit field wins); key from URL discarded — deterministic, documented in field description |
| Enters `http://` production endpoint | Persistent warning under the field; sync still works (user choice), but cleartext is called out. `http://localhost` / `http://127.0.0.1` show no warning |
| Leaves Access Key empty | Server returns 401; manual sync surfaces "Invalid or missing access key" in a Notice (existing error path); settings description says the field is required |
| Whitespace around pasted key | Trimmed in `onChange`, same as the URL field |
| Old plugin version talking to updated server | Unaffected — `?key=` fallback still accepted |
| Updated plugin talking to old server | Unaffected — server-side header support predates this change |

## Security Analysis

Threats considered (full model recorded in `ThreatModel.md` at repo root, created by this change):

1. **Timing attack on key comparison** — mitigated by D1 (digest + branch-free compare).
2. **Key disclosure via URL surfaces** (proxy/edge logs, Referer, browser history, shared screenshots of settings) — mitigated by D3/D4 for the plugin path; residual: MCP client configs still embed `?key=` (documented, deprecated).
3. **Cleartext interception** — surfaced by D5's warning; not blocked (localhost/LAN legitimacy).
4. **Key at rest in `data.json`** — accepted risk, already documented in README's warning block; unchanged here.
5. **CORS `origin: "*"`** — unchanged; the access key (never ambient/cookie-based) is the actual gate, so cross-origin requests without the key remain 401.
6. **Brute force** — unchanged; key is operator-generated high entropy (README instructs `openssl rand`-class generation). Rate limiting out of scope.

## API Contract

Recorded in `docs/api-frontend-guide.md` (created by this change):

- **Auth (all routes, MCP + direct HTTP):** send `x-brain-key: <MCP_ACCESS_KEY>` request header. `?key=<MCP_ACCESS_KEY>` remains accepted but deprecated (only for clients that cannot set headers, e.g. MCP client configs). On mismatch/absence: HTTP 401 `{"error": "Invalid or missing access key"}`. No other request/response shapes change.

## Test Strategy

| Layer | What | Why this layer |
|---|---|---|
| Deno integration (`tests/integration/auth.test.ts`, new) | Header accepted (200-class), wrong/missing key rejected (401) for MCP root and a direct route; `?key=` fallback still accepted; header wins when both present | Auth is enforced by the real edge function — only meaningful against the running stack; also the GATE-1 denial tests for this access-control change |
| Plugin unit (vitest, `main.test.ts`) | `callHTTP`/`callIngestNote` include `x-brain-key` when `accessKey` set and omit it when empty; `loadSettings` migration extracts+strips `?key=` (incl. other-params and already-set-accessKey cases); `isInsecureEndpoint` scheme/host matrix | Pure logic on the plugin side; Obsidian API not on the tested path (fetch is the boundary, mocked per unit-test rules) |
| E2E | Not applicable as a browser flow — the plugin runs in Obsidian, not a web page. The integration tier above exercises the real HTTP auth path end-to-end against the real server, including denial | Matches test-plan.md rationale |

No failing-first requirement (feature step, not a bug replication), except: the plugin "key not in URL" test is written against current behavior first to demonstrate the change (it fails before the plugin edit — key currently rides the URL).

## Risks / Trade-offs

- [`?key=` fallback keeps the URL surface alive for MCP clients] → explicitly documented as deprecated; plugin path fully migrated; revisit removal when MCP clients support per-request headers broadly.
- [Auto-extracting `?key=` on paste surprises a user who *wanted* it in the URL] → field description explains the behavior; the extracted key is visible in the Access Key field immediately.
- [Digest-based compare does two SHA-256s per request] → negligible (~µs) against an edge-function cold-start baseline of ms.
- [Existing Deno tests authenticate via `?key=` URLs] → unchanged and still passing (fallback retained); consolidation happens in Step 5.

## Migration Plan

1. Server change deploys first or simultaneously — it is backward compatible (fallback retained).
2. Plugin update migrates settings automatically on next load; no user action needed.
3. Rollback: revert commits; old `?key=` URLs still work throughout, so a rollback window has no auth outage.

## Open Questions

(none)
