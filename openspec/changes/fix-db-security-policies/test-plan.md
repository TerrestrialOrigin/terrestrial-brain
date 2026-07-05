# Test Plan: fix-db-security-policies

All scenarios are **integration-layer** tests: they exercise the real local Supabase stack (PostgreSQL + PostgREST + edge function, started via `npx supabase start`) with zero mocks on the tested path. There is no unit layer for this change (no application logic — SQL policy/grant statements only, and a unit test of SQL text would be vacuous) and no browser E2E layer (this repo has no UI; the Deno integration suite against the full local stack is the end-to-end layer, per the remediation-plan protocol).

Replicate-before-fix: every "denial" test below MUST be written first and confirmed **failing** against the current schema (anon access succeeds today), then pass after the migration.

| Spec scenario (specs/database-access-control/spec.md) | Layer | Test file / test |
|---|---|---|
| Anon key cannot read people | Integration | `tests/integration/db_access_control.test.ts` — anon SELECT returns zero rows for a service-role-seeded person |
| Anon key cannot insert into people | Integration | same file — anon INSERT rejected with 42501, row absent via service role |
| Anon key cannot update people | Integration | same file — anon UPDATE affects zero rows; data unchanged via service role |
| Anon key cannot delete from people | Integration | same file — anon DELETE affects zero rows; row still present via service role |
| Service role retains full access to people | Integration | same file — service-role CRUD regression assertion; plus existing people MCP-tool suite (`tests/integration/`) stays green |
| Anon key cannot execute increment_usefulness | Integration | same file — anon RPC rejected with permission denied; seeded thought's `usefulness_score` unchanged |
| Service role can still execute increment_usefulness | Integration | same file — service-role RPC increments score by 1; plus existing usefulness tests in `tests/integration/thoughts.test.ts` stay green |

## Denial-assertion semantics (what "denied" means via PostgREST)

Post-fix, anon/authenticated hold no table DML grants and no function EXECUTE (design D10), so every verb is rejected at the privilege level: HTTP 401/403 with SQLSTATE 42501. Each denial test also verifies zero state change via a service-role re-read. (Pre-fix, the failing-first run observed anon succeeding at all five operations under the old environment defaults + unscoped RLS policy.)

## Full-suite gates (zero failures, zero skips)

- `deno test --allow-net --allow-env tests/` (full local stack running)
- `cd obsidian-plugin && npm test && npm run build`
