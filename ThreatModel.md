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
| T2 | Key disclosure via URL surfaces (proxy/CDN/edge logs, Referer headers, browser history, screenshots) | **Mitigated (default)** (edge-security-residual) | The `?key=` query-param fallback is now **rejected by default** — the `x-tb-key` header is the only accepted credential unless an operator explicitly sets `TB_ALLOW_KEY_IN_QUERY=1` for a client that cannot send headers. The plugin already sends the key only as a header and auto-migrates legacy `?key=` out of stored settings. With the flag off (the shipping default) no client can put the key in a URL; the residual applies only to installs that deliberately opt in. Guarded by `resolveProvidedKey` (`security-config.ts`) + auth deny tests (`tests/integration/auth.test.ts`) |
| T3 | Cleartext interception of notes + key over plain HTTP | **Surfaced** (header-based-auth) | Settings tab shows a persistent warning for `http://` endpoints on non-local hosts (`localhost`/`127.0.0.1` exempt). Not hard-blocked: LAN/self-hosted setups are legitimate |
| T4 | Key theft from Obsidian plugin data (`data.json` is unencrypted; a malicious plugin could read it) | **Accepted, documented** | Standard Obsidian practice; called out in README's warning block. Revisit if Obsidian adds a secrets API |
| T5 | Anon-key access to database tables / privileged functions | **Mitigated** (fix-db-security-policies) | RLS policies scoped `to service_role`; DML + EXECUTE revoked from `anon`/`authenticated`, with default privileges altered for future objects |
| T6 | Brute-forcing the access key | **Accepted (low risk)** | Key is operator-generated high entropy (README setup instructs a random string). No rate limiting at the edge — revisit if abuse is observed (function-call logs record caller IPs) |
| T7 | Cross-origin browser calls (wildcard CORS lets any page script the endpoint) | **Mitigated** (edge-security-residual) | CORS now **defaults to deny**: the app reflects `Access-Control-Allow-Origin` only for origins in the operator-configured `TB_ALLOWED_ORIGINS` allowlist (empty by default → no cross-origin), and never emits `*`. The Obsidian plugin and MCP clients are not browsers and need no CORS. Auth remains the authoritative gate regardless (a cross-origin page without the key still gets 401). Verified in-process against the real middleware (`tests/unit/cors-middleware.test.ts`). **Note:** the local Supabase dev gateway (Kong) injects permissive `*` on `/functions/v1/*`, masking the app on the local network path; hosted deployments are app-authoritative (functions own their CORS), which is why the assertion is made in-process rather than through the local stack |
| T8 | Prompt injection via ingested note content into the LLM extraction pipeline | **Partially addressed** | The Slack ingest surface was removed (`remove-slack-integration`); remaining ingest paths all require the access key. LLM-driven destructive writes are being removed separately (fix-plan Step 4: soft-archive instead of hard delete) |
| T9 | Missing required secret silently degrades the function (`Bearer undefined`, broken auth) | **Mitigated** (fail-fast-env-and-errors) | `requireEnv` throws at cold start naming the missing variable; the function refuses to boot rather than run with an undefined secret |
| T10 | Secret disclosure through surfaced error text | **Mitigated** (fail-fast-env-and-errors) | `requireEnv` throws with the variable *name* only, never its value; the `(section unavailable: <reason>)` marker echoes only the Supabase error message (schema/constraint text), no secret material |
| T11 | Surfaced DB error messages leak internal schema detail to a caller | **Accepted (low risk)** (fail-fast-env-and-errors) | Caller is already past the shared-secret gate; the marker exposes no more than the existing top-level `catch`/`console.error`. No new external surface |
| T12 | Destructive erasure abuse via `forget_note` / `/forget-note` (permanent hard-delete of a note's snapshot + thoughts) | **Mitigated** (gdpr-data-lifecycle) | Same `x-tb-key` gate as every other route (401 without it); scoped to a single `reference_id` — no bulk/wildcard delete; idempotent, so a replay does no extra damage; never reachable from an LLM path (contrast the LLM reconciliation path, which can only soft-archive per fix-plan Step 4) |
| T13 | Indefinite retention of personal note content + caller IPs in `function_call_logs` (GDPR data minimization) | **Mitigated** (gdpr-data-lifecycle) | Rows purged after a retention window via `purge_function_call_logs` (default 90 days, scheduled where `pg_cron` is available; EXECUTE service-role-only); serialized log input capped at 10,000 chars so a single row cannot accumulate unbounded content |
| T14 | New `function_call_logs.returned_ids` column accumulates linkable personal data / widens a data surface (GDPR data minimization) | **Mitigated** (records-returned-telemetry) | Column stores opaque entity UUIDs **only**, never thought/note content; written only by thought-retrieval reads, bounded by `MAX_QUERY_LIMIT = 100` ids per row; lives in the same service-role-only, RLS-protected table and is purged by the same 90-day `purge_function_call_logs` window as every other column. No new auth surface (same `x-tb-key` gate), no external consumer, and the value is stripped from the MCP client payload (never leaves the server) |
| T15 | Memory-mechanism audit against the live production DB corrupts data or leaks the Management API access token | **Mitigated, procedural** (memory-mechanism-audit) | The audit runbook (`docs/usefulness-audit-runbook.md`) is Ground-Rule-enforced READ-ONLY: every query is a `SELECT`, no `UPDATE`/`DELETE`/`INSERT` runs during an audit, and any needed fix is filed as a task rather than hot-fixed against prod. The access token is read from the system keyring into a shell variable and is never echoed, written to a file, committed, or pasted into the report. Enforcement is procedural (the token is the operator's own CLI token with full rights) — the control is the discipline codified in the runbook and this row, not a technical write-block |
| T16 | Mutation-ruleset bypass: a future memory console or PMS connector writes memory directly, skipping the one server-side update path, evading re-embed/re-hash and the dedup gate (stale search + duplicate leak — the disease the product cures) | **Mitigated** (memory-hygiene) | Step 7 implements INVARIANT 1 in the single server-side update path: every content edit re-embeds (thoughts) + re-hashes (`content_hash` on thoughts/projects/tasks/documents), and every mutation records `last_actor` (LLM \| user \| sync) through that one path. The write-time dedup gate runs on every create path. Test-guarded by the `lifecycle-rules-verification` deterministic tier (INVARIANT-1 hash-equals across all four entities, actor recorded per path, dedup blocks duplicates) |
| T17 | Poisoned extraction: a hallucinated or injected `type` (or other metadata) flows unvalidated into a stored mutation | **Mitigated** (memory-hygiene) | Step 7 parses `extractMetadata` output against the `THOUGHT_TYPES` allowlist (extended with `instruction`/`decision`) in `coerceThoughtType`, coercing an out-of-allowlist or missing value to the `observation` fallback and logging it — `parse, don't cast` at the seam. Test-guarded (out-of-allowlist → `observation`; allowlisted preserved) |
| T18 | Silent status divergence: a UI or sync shortcut closes a PMS-origin task locally only, so TB and the PMS disagree without a consented decision | **Specified** (integration-sync-rules) | The sync spec mandates consented close + stays-open-on-failure/decline and single-owner status precedence (PMS owns PMS-origin status); `test`-tagged. Implementation deferred to the v1.5+ connector; the rule is fixed now |
| T19 | Destructive supersession: contradiction handling that deletes/overwrites the older belief loses the audit trail and is unrecoverable | **Mitigated** (memory-hygiene) | Step 7 implements supersession as a retained `thoughts.superseded_by` edge: `search_thoughts_by_embedding` excludes superseded thoughts from default retrieval while they stay fetchable by id, and the `resolve_supersession` tool sets/clears the edge (fully reversible) — never delete/overwrite. Test-guarded on the effect (superseded thought leaves default search, row kept, edge reversible). Contradiction *detection* (which thought to supersede) is model judgment on the opt-in eval tier |
| T20 | Webhook replay/forgery: at-least-once delivery re-triggers extraction or a forged event mutates memory | **Specified** (integration-sync-rules) | The sync spec requires a cursor + content-hash idempotency gate (duplicate/trivial-edit events are no-ops) and connector secret validation; `test`-tagged on idempotent replay. Implemented with the first connector (v1.5+) |
| T21 | Vacuous-green verification harness: a lifecycle test that mocks the very behavior it claims to verify (e.g. faking the dedup decision) would pass without the feature existing, laundering unsafe behavior as safe | **Mitigated** (lifecycle-rules-test-harness) | The deterministic tier asserts on durable DB state (row counts, `metadata.type`, `usefulness_score`, column/tool existence) via the service role, never on prose; the only permitted mock is the external-LLM seam (`extractMetadata`), and only where the rule is *about* parsing LLM output. Shipped-behavior tests are mutation-checked (removing the implementation line reddens them). Enforced by the mock-boundary rule in review |
| T22 | Dishonest red: a red-by-design failure masking a genuine harness bug (a crash, wrong route, or typo) so a real gap hides behind the intended red | **Mitigated** (lifecycle-rules-test-harness) | Every pending test fails for exactly one documented reason via a `PENDING(<milestone>:<slug>)` marker in its name and assertion message; the RED reason is verified at apply-time to match the marker (not an unrelated error). Capability-absent tests anchor on explicit `hasTool` / `columnExists` probes rather than ambiguous unknown-tool errors |
| T23 | Silent coverage gap: a Step 5 scenario with no executable check gives false confidence that a rule is verified | **Mitigated** (lifecycle-rules-test-harness) | `tests/unit/lifecycle-coverage.test.ts` parses both delta specs and asserts a bijection with `tests/lifecycle-coverage.manifest.ts`; any uncovered, renamed, or removed scenario fails the build. The manifest also logs the red→green burn-down (pass-now / pending-step7 / pending-v1.5) |

## Compliance notes (non-STRIDE)

- **Licensing & third-party attribution.** The public repository ships an
  explicit license (`LICENSE.md`, FSL-1.1-MIT) and a third-party attribution
  notice (`NOTICE.md`) for MIT-era Open Brain material. This closes a
  compliance gap (a public repo carrying third-party MIT material with no
  license file and no attribution) rather than a runtime attack surface — no
  code, input, or auth path is affected.
- **Marketing branding separated from provenance.** Public marketing surfaces
  (README headline, GitHub repository description) describe the product on its
  own terms with no Open Brain / OB1 / Nate reference; the required MIT
  attribution is retained in `NOTICE.md` and the README License section
  (change `branding-separation`). A deterministic docs-consistency test
  (`tests/unit/branding-separation.test.ts`) guards against reintroduction. No
  code, input, or auth path is affected.

## Out of scope (accepted for a single-tenant personal system)

- Multi-user authentication / authorization, per-client keys, key rotation schedules.
- Encryption at rest beyond what Supabase provides.
- Network-level controls (IP allowlists, mTLS).
