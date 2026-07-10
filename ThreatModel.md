# Threat Model — Terrestrial Brain

Living document. Each OpenSpec change with security impact records its analysis here
(started by change `header-based-auth`, 2026-07-04).

## Trust model (current)

- **Security boundary:** a single shared secret, `MCP_ACCESS_KEY`, verified by the
  `terrestrial-brain-mcp` edge function on every request (MCP and direct HTTP routes alike).
- **Transport of the secret:** `x-tb-key` request header (primary). `?key=` query
  parameter (deprecated) is retained only for MCP clients that cannot set custom headers.
  The secret is deliberately carried in a dedicated custom header rather than
  `Authorization: Bearer` — this keeps the app-level shared secret separate from the
  Supabase/Kong gateway's own `Authorization`/JWT channel, avoiding a gateway-level
  collision where the platform would try to validate the key as a JWT (recorded by
  change `ob1-fragment-rewrite`).
- **Database access:** the edge function uses the Supabase service-role key exclusively.
  Row-Level Security policies exist to lock the public anon key out of ALL data and
  privileged functions (enforced by change `fix-db-security-policies`); RLS is NOT a
  per-user authorization layer.
- **Tenancy:** single-tenant, single shared key. There is no per-user identity, key
  rotation, or scoping. This is an accepted design constraint for a personal system.

## Threats and mitigations

| # | Threat | Status | Mitigation / Rationale |
|---|---|---|---|
| T1 | Timing attack recovers `MCP_ACCESS_KEY` through the key comparison | **Mitigated** (header-based-auth) | Comparison hashes both values to SHA-256 digests and compares with a branch-free XOR fold — no short-circuit, no length leak (`terrestrial-brain-mcp/index.ts`, `accessKeyMatches`) |
| T2 | Key disclosure via URL surfaces (proxy/CDN/edge logs, Referer headers, browser history, screenshots) | **Mitigated for the plugin** (header-based-auth) | Plugin sends the key only as an `x-tb-key` header; legacy `?key=` in stored settings is auto-migrated out of the URL. Residual: MCP client configs (Claude Desktop/Code) may still embed `?key=` — documented as deprecated in README |
| T3 | Cleartext interception of notes + key over plain HTTP | **Surfaced** (header-based-auth) | Settings tab shows a persistent warning for `http://` endpoints on non-local hosts (`localhost`/`127.0.0.1` exempt). Not hard-blocked: LAN/self-hosted setups are legitimate |
| T4 | Key theft from Obsidian plugin data (`data.json` is unencrypted; a malicious plugin could read it) | **Accepted, documented** | Standard Obsidian practice; called out in README's warning block. Revisit if Obsidian adds a secrets API |
| T5 | Anon-key access to database tables / privileged functions | **Mitigated** (fix-db-security-policies) | RLS policies scoped `to service_role`; DML + EXECUTE revoked from `anon`/`authenticated`, with default privileges altered for future objects |
| T6 | Brute-forcing the access key | **Accepted (low risk)** | Key is operator-generated high entropy (README setup instructs a random string). No rate limiting at the edge — revisit if abuse is observed (function-call logs record caller IPs) |
| T7 | Cross-origin browser calls (CORS is `origin: "*"`) | **Accepted by design** | Auth is a non-ambient explicit header, not cookies — a cross-origin page without the key gets 401. Wildcard CORS is what lets arbitrary MCP web clients connect |
| T8 | Prompt injection via ingested note content into the LLM extraction pipeline | **Partially addressed** | The Slack ingest surface was removed (`remove-slack-integration`); remaining ingest paths all require the access key. LLM-driven destructive writes are being removed separately (fix-plan Step 4: soft-archive instead of hard delete) |
| T9 | Missing required secret silently degrades the function (`Bearer undefined`, broken auth) | **Mitigated** (fail-fast-env-and-errors) | `requireEnv` throws at cold start naming the missing variable; the function refuses to boot rather than run with an undefined secret |
| T10 | Secret disclosure through surfaced error text | **Mitigated** (fail-fast-env-and-errors) | `requireEnv` throws with the variable *name* only, never its value; the `(section unavailable: <reason>)` marker echoes only the Supabase error message (schema/constraint text), no secret material |
| T11 | Surfaced DB error messages leak internal schema detail to a caller | **Accepted (low risk)** (fail-fast-env-and-errors) | Caller is already past the shared-secret gate; the marker exposes no more than the existing top-level `catch`/`console.error`. No new external surface |
| T12 | Destructive erasure abuse via `forget_note` / `/forget-note` (permanent hard-delete of a note's snapshot + thoughts) | **Mitigated** (gdpr-data-lifecycle) | Same `x-tb-key` gate as every other route (401 without it); scoped to a single `reference_id` — no bulk/wildcard delete; idempotent, so a replay does no extra damage; never reachable from an LLM path (contrast the LLM reconciliation path, which can only soft-archive per fix-plan Step 4) |
| T13 | Indefinite retention of personal note content + caller IPs in `function_call_logs` (GDPR data minimization) | **Mitigated** (gdpr-data-lifecycle) | Rows purged after a retention window via `purge_function_call_logs` (default 90 days, scheduled where `pg_cron` is available; EXECUTE service-role-only); serialized log input capped at 10,000 chars so a single row cannot accumulate unbounded content |
| T14 | New `function_call_logs.returned_ids` column accumulates linkable personal data / widens a data surface (GDPR data minimization) | **Mitigated** (records-returned-telemetry) | Column stores opaque entity UUIDs **only**, never thought/note content; written only by thought-retrieval reads, bounded by `MAX_QUERY_LIMIT = 100` ids per row; lives in the same service-role-only, RLS-protected table and is purged by the same 90-day `purge_function_call_logs` window as every other column. No new auth surface (same `x-tb-key` gate), no external consumer, and the value is stripped from the MCP client payload (never leaves the server) |

## Compliance notes (non-STRIDE)

- **Licensing & third-party attribution.** The public repository ships an
  explicit license (`LICENSE.md`, FSL-1.1-MIT) and a third-party attribution
  notice (`NOTICE.md`) for MIT-era Open Brain material. This closes a
  compliance gap (a public repo carrying third-party MIT material with no
  license file and no attribution) rather than a runtime attack surface — no
  code, input, or auth path is affected.

## Out of scope (accepted for a single-tenant personal system)

- Multi-user authentication / authorization, per-client keys, key rotation schedules.
- Encryption at rest beyond what Supabase provides.
- Network-level controls (IP allowlists, mTLS).
