## Context

The `terrestrial-brain-mcp` edge function (`supabase/functions/terrestrial-brain-mcp/index.ts`) is the system's single network boundary. Earlier hardening (fix-plan Steps 1/3, `header-based-auth`) moved the shared secret out of the URL into the `x-tb-key` header, added a constant-time comparison, and migrated the plugin off `?key=`. Two residual surfaces were deferred and are now in scope:

1. **CORS is wildcard** (`index.ts:383` → `origin: "*"`). `ThreatModel.md` T7 accepted this "by design" because auth is a non-ambient explicit header, so a cross-origin page without the key still gets 401. That reasoning holds for *data theft*, but shipping `Access-Control-Allow-Origin: *` on a public product invites any web page to script the endpoint and is an unnecessary surface. No browser client ships in this repo.
2. **`?key=` query-param fallback is unconditionally accepted** (`index.ts:395-398`). T2's residual note flags that keys in URLs leak through proxy/CDN/edge logs and traces. It is documented as deprecated but still fully live.

Constraints:
- The Obsidian plugin uses Electron `requestUrl` and already sends the key only as a header — it is **not** subject to browser CORS and does not use `?key=`.
- MCP clients (Claude Desktop/Code) are not browsers either; they can set custom headers in current configs.
- Env access must go through the fail-fast `requireEnv` discipline for required secrets; these two new vars are **optional** with secure defaults, so they use `Deno.env.get` guarded by a parse-at-boundary helper (never a raw `!`).
- Migrations are append-only; this change touches no schema.

## Goals / Non-Goals

**Goals:**
- Default-deny CORS: no `Access-Control-Allow-Origin` emitted unless the request's `Origin` is in an operator-configured allowlist (`TB_ALLOWED_ORIGINS`).
- Default-reject `?key=`: authenticate on the `x-tb-key` header only, unless the operator explicitly opts in with `TB_ALLOW_KEY_IN_QUERY=1`.
- Keep both switches configurable so a future web console (Step 17) and header-incapable MCP clients remain supportable without a code change.
- Validate both env vars once at the boundary into known-good types (parse, don't cast).

**Non-Goals:**
- Rate limiting / brute-force protection (T6 stays accepted).
- Changing the constant-time comparison or the shared-secret model.
- Any plugin change (already header-only) or schema/migration change.
- Building the console that would populate `TB_ALLOWED_ORIGINS`.

## Decisions

### D1 — CORS allowlist via `TB_ALLOWED_ORIGINS`, default deny

Introduce a config seam module `security-config.ts` with a pure `parseAllowedOrigins(raw: string | undefined): string[]` (split on comma, trim, drop empties) and `buildCorsOriginResolver(allowlist: string[])` returning the function Hono's `cors({ origin })` accepts. The resolver returns the request origin **only if it is in the allowlist**, otherwise `null` — Hono then emits no `Access-Control-Allow-Origin` header, so a browser blocks the response. When `TB_ALLOWED_ORIGINS` is unset the allowlist is empty and every cross-origin request is denied.

*Why a function resolver over a string/array:* passing `origin: allowlist` (array) would make Hono reflect only listed origins, which is close — but a function lets us keep exactly one code path for the empty (deny-all) and populated cases, and makes the deny decision unit-testable in isolation. *Why not keep `"*"`:* an open product should not advertise itself as scriptable from any page; least privilege by default.

`allowHeaders` stays `["Content-Type", "x-tb-key"]`; `allowMethods` unchanged.

### D2 — `?key=` behind `TB_ALLOW_KEY_IN_QUERY`, default off

Add `isKeyInQueryAllowed(raw: string | undefined): boolean` (true only for the exact string `"1"`) and `resolveProvidedKey({ headerKey, queryKey, allowKeyInQuery })` returning the key to compare: the header value when present; else the query value **only if** `allowKeyInQuery`; else `null`. The comparison and 401 behavior downstream are unchanged. The header always wins when present (preserving the existing precedence, including the "invalid header + valid query → 401" case).

*Why an env flag over full removal:* the New-Feature-Plan explicitly allows keeping the fallback for MCP clients that cannot set headers. A default-off flag gives the secure posture by default while leaving a documented, deliberate escape hatch — no code change needed to re-enable. *Why `"1"` exactly (not truthy-ish):* avoid the classic `"0"`/`"false"` string-is-truthy footgun; an explicit sentinel is unambiguous (parse, don't cast).

### D3 — One composition-root read, pure helpers

`index.ts` reads `TB_ALLOWED_ORIGINS` and `TB_ALLOW_KEY_IN_QUERY` once at module load (composition root), passes the parsed values into the middleware config and the request handler. All parsing/decision logic lives in `security-config.ts` as pure functions with no `Deno.env` access, so both flag states are exhaustively unit-testable without a running stack, and the wired default is verified against the real stack.

## Risks / Trade-offs

- **[A client silently relying on `?key=` breaks after upgrade]** → It's already documented deprecated; `docs/upgrade.md` gets an explicit entry with the one-line remedy (`TB_ALLOW_KEY_IN_QUERY=1`) and the recommended fix (move the key to the header). This is an intended breaking change on a self-hosted base.
- **[A future web console forgets to set `TB_ALLOWED_ORIGINS` and appears "broken"]** → README env table documents the var; the failure mode is a clear CORS error in the browser console, not silent data loss. Deny-by-default is the correct posture.
- **[CORS gives false sense of security]** → Documented in `ThreatModel.md`: CORS is browser-only and auth remains the real gate; non-browser clients ignore CORS entirely. Locking it down removes an *unnecessary* surface, it is not the primary control.
- **[Misparsing the allowlist (trailing comma, spaces)]** → `parseAllowedOrigins` trims and drops empties; unit-tested with messy input.

## User-error scenarios

| User mistake | System behavior |
|---|---|
| Operator sets `TB_ALLOWED_ORIGINS=" https://a.com , , https://b.com "` (spaces, empty entry) | Parsed to `["https://a.com","https://b.com"]`; empties dropped, no crash. |
| Operator sets `TB_ALLOW_KEY_IN_QUERY=true` (not `1`) | Treated as off (secure default); only the exact `"1"` opts in. Documented. |
| Client keeps using `?key=` after upgrade without the flag | Request gets 401 (`x-tb-key` absent), same canonical error body — a clear auth failure, not a silent partial success. |
| Browser page from a disallowed origin scripts the endpoint | Preflight/response carries no `Access-Control-Allow-Origin`; the browser blocks it. Even if forced, no key ⇒ 401. |
| Operator leaves both vars unset (default) | Most-secure posture: header-only auth, no cross-origin — the intended default for the plugin + MCP clients. |

## Security analysis (ThreatModel updates)

- **T2 (key disclosure via URL)** → upgraded from "Mitigated for the plugin / residual for MCP configs" to **Mitigated (default)**: `?key=` is rejected unless the operator explicitly opts in; keys-in-URL is off by default across every client.
- **T7 (wildcard CORS)** → changed from "Accepted by design" to **Mitigated**: CORS defaults to deny; cross-origin is allowed only for operator-listed origins. Note retained that auth (not CORS) is the real gate.
- No new secret material is introduced; both vars are non-secret operational config. No new external surface — the change only *narrows* what is accepted.

## Test Strategy

- **Unit (deterministic, no stack)** — new `tests/unit/security-config.test.ts` exercises `parseAllowedOrigins` (empty/unset → `[]`, messy input trimmed), `buildCorsOriginResolver` (listed origin reflected, unlisted → `null`, empty allowlist denies all), `isKeyInQueryAllowed` (`"1"` true; `""`/undefined/`"true"`/`"0"` false), and `resolveProvidedKey` across all four branches incl. both flag states and header-precedence. This covers the opt-**in** ("on") `?key=` path deterministically.
- **Integration (real local stack, no mocks on the path)** — the stack's `supabase/functions/.env` sets `TB_ALLOWED_ORIGINS` to a known test origin and leaves `TB_ALLOW_KEY_IN_QUERY` unset (shipping default). `tests/integration/auth.test.ts` flips the two `?key=`-accept cases to expect 401 and keeps the header cases; new CORS assertions verify the allowlisted origin is reflected in `Access-Control-Allow-Origin` and a disallowed/absent origin is **not**. CORS is asserted on the *response headers* (Deno `fetch` does not itself enforce CORS), which is the correct server-side observation.
- **GATE 2b mutation check:** reverting the CORS resolver to `"*"` reddens the disallowed-origin integration assertion; removing the `allowKeyInQuery` gate (always-accept query) reddens the default-reject integration test, and (always-reject) reddens the unit "on" test — both directions guarded across the two tiers.

## Migration Plan

1. Land code + tests; set `TB_ALLOWED_ORIGINS` in the test-stack `.env`.
2. `docs/upgrade.md`: document the two new vars and the `?key=` default change with the remedy.
3. Production deploy sets neither var initially (plugin + MCP header clients unaffected) → deny-CORS, header-only auth. If a header-incapable client surfaces, operator sets `TB_ALLOW_KEY_IN_QUERY=1`; if the web console lands (Step 17), operator sets `TB_ALLOWED_ORIGINS`.
4. **Rollback:** revert the commit; no schema/data change means rollback is code-only and instantaneous.

## Open Questions

None blocking. (Whether the future console shares this env var or gets its own is a Step 17 decision; the seam supports either.)
