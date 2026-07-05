# Threat Model — Terrestrial Brain

Living document. Each OpenSpec change with security impact records its analysis here
(started by change `header-based-auth`, 2026-07-04).

## Trust model (current)

- **Security boundary:** a single shared secret, `MCP_ACCESS_KEY`, verified by the
  `terrestrial-brain-mcp` edge function on every request (MCP and direct HTTP routes alike).
- **Transport of the secret:** `x-brain-key` request header (primary). `?key=` query
  parameter (deprecated) is retained only for MCP clients that cannot set custom headers.
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
| T2 | Key disclosure via URL surfaces (proxy/CDN/edge logs, Referer headers, browser history, screenshots) | **Mitigated for the plugin** (header-based-auth) | Plugin sends the key only as an `x-brain-key` header; legacy `?key=` in stored settings is auto-migrated out of the URL. Residual: MCP client configs (Claude Desktop/Code) may still embed `?key=` — documented as deprecated in README |
| T3 | Cleartext interception of notes + key over plain HTTP | **Surfaced** (header-based-auth) | Settings tab shows a persistent warning for `http://` endpoints on non-local hosts (`localhost`/`127.0.0.1` exempt). Not hard-blocked: LAN/self-hosted setups are legitimate |
| T4 | Key theft from Obsidian plugin data (`data.json` is unencrypted; a malicious plugin could read it) | **Accepted, documented** | Standard Obsidian practice; called out in README's warning block. Revisit if Obsidian adds a secrets API |
| T5 | Anon-key access to database tables / privileged functions | **Mitigated** (fix-db-security-policies) | RLS policies scoped `to service_role`; DML + EXECUTE revoked from `anon`/`authenticated`, with default privileges altered for future objects |
| T6 | Brute-forcing the access key | **Accepted (low risk)** | Key is operator-generated high entropy (README setup instructs a random string). No rate limiting at the edge — revisit if abuse is observed (function-call logs record caller IPs) |
| T7 | Cross-origin browser calls (CORS is `origin: "*"`) | **Accepted by design** | Auth is a non-ambient explicit header, not cookies — a cross-origin page without the key gets 401. Wildcard CORS is what lets arbitrary MCP web clients connect |
| T8 | Prompt injection via ingested note content into the LLM extraction pipeline | **Partially addressed** | The Slack ingest surface was removed (`remove-slack-integration`); remaining ingest paths all require the access key. LLM-driven destructive writes are being removed separately (fix-plan Step 4: soft-archive instead of hard delete) |

## Out of scope (accepted for a single-tenant personal system)

- Multi-user authentication / authorization, per-client keys, key rotation schedules.
- Encryption at rest beyond what Supabase provides.
- Network-level controls (IP allowlists, mTLS).
