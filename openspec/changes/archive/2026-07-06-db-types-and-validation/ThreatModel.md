# Threat Model — db-types-and-validation

Scope: input validation and typing at the MCP tool boundary. Auth/RLS are unchanged (a single shared `MCP_ACCESS_KEY` at the edge remains the trust boundary; this change assumes an already-authenticated caller and hardens what that caller can do to the DB).

| # | Threat | Vector | Impact | Mitigation |
|---|--------|--------|--------|------------|
| T1 | `ilike` wildcard/pattern injection | User-supplied search text with `%`/`_`/`\` in a document/thought search param feeds an `ilike` pattern unescaped | A single `%` returns the entire table (information disclosure across the knowledge base, and a cost/latency amplifier); `_` and `\` corrupt intended matches | D4: shared `escapeLikePattern` escapes `\`,`%`,`_` (backslash first) inside repository search methods; pattern uses default `\` escape char. Integration test: searching a literal `%` matches only rows containing `%`. |
| T2 | Unbounded fetch (resource exhaustion / cost) | `limit` param with no upper bound; caller requests millions of rows | Memory/CPU/egress spike on a CPU-limited edge function; potential DoS | D2: `.min(1).max(100)` on every `limit`; out-of-range rejected at the boundary. |
| T3 | Out-of-domain value persisted | `status`/`type`/`reliability` accepted as free `z.string()` | A hallucinated/typo'd value is written and later breaks readers/filters (integrity) | D1: `z.enum([...])` matched to DB CHECK constraints rejects it at the door. |
| T4 | Malformed id treated as "no data" | Non-UUID `*_id` reaches the query and returns empty | Masks a caller bug as an empty result; can hide authorization/lookup errors | D2: `.uuid()` rejects malformed ids with a clear message instead of a silent empty. |
| T5 | Phantom-success update | `update_*` on a nonexistent UUID returns success with no affected-row check | Caller (LLM) believes a write happened; silent data-integrity confusion | D3: affected-row verification in each repository `update`; zero rows → not-found, never a false success. |
| T6 | Over-privileged RPC | New `thought_stats` SQL function granted default public EXECUTE | anon/authenticated key holder invokes aggregate over personal data, bypassing intended service-role-only access | D6: `SECURITY INVOKER`; `REVOKE EXECUTE … FROM anon, authenticated`; `GRANT EXECUTE … TO service_role` (mirrors Step 1's `increment_usefulness` hardening). |

## Residual risk
- The shared-secret edge auth model is unchanged (documented, single-tenant). This change does not widen it.
- Generated `database.types.ts` is machine-authored and committed; it carries no runtime secrets. No new network egress or secret handling is introduced.
