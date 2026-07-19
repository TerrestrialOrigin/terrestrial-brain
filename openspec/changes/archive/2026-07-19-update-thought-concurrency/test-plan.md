# Test Plan — update-thought-concurrency

Bug-fix protocol: replication tests are written FIRST and confirmed RED against current code.

| Spec scenario | Layer | Test file | Notes |
|---|---|---|---|
| Interleaved update from a stale snapshot is rejected (handler) | Unit | `tests/unit/update-thought-concurrency.test.ts` | fake ThoughtRepository records the options argument and reports no-match; assert concurrent-edit error + `expectedUpdatedAt` passed. RED now (handler passes no guard, reports success) |
| Update from a fresh snapshot succeeds | Unit | same | fake reports match → normal confirmation (control) |
| Guarded update with a stale timestamp matches nothing (chain) | Unit | same | `makeFakeClient` records filters; assert `.eq("updated_at", …)` + `.select("id")` present with option, absent without |
| Guarded stale update matches nothing / fresh succeeds (real DB) | Integration | `tests/integration/thoughts.test.ts` (extend) | capture → findForUpdate → update once → stale second update ⇒ `data: null`, values from update 1 intact; re-read → update ⇒ succeeds. Deterministic replication of the interleave |
| Unguarded update keeps prior behavior | Unit + existing suite | existing repository/handler tests | signature is optional; suite compile + green proves no regression |

GATE 2b: deleting the `.eq("updated_at", …)` filter or the handler's null-check turns the stale-snapshot tests red.
Mock audit: fakes only on the repository seam / fake Supabase client; handler + real repository implementation are the code under test.
E2E: no browser-facing workflow in this repo path; the integration layer (real Postgres + trigger) is the end-to-end for this behavior.
