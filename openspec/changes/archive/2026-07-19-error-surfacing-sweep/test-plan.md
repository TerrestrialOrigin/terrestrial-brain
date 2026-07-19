# Test Plan — error-surfacing-sweep

Maps every delta-spec scenario to a test layer. Bug-fix protocol: each new test is written FIRST and confirmed RED against current code before the fix.

| Spec scenario | Layer | Test file | Notes |
|---|---|---|---|
| Failed open-task count in get_project | Unit | `tests/unit/error-surfacing.test.ts` | fake TaskRepository returning `{ data: null, error }`; assert `? (lookup failed)` not `0` |
| Failed open-task count in get_person | Unit | `tests/unit/error-surfacing.test.ts` | same fake pattern |
| Failed parent-name or children lookup in get_project | Unit | `tests/unit/error-surfacing.test.ts` | fake ProjectRepository failing `findName` / `listChildrenBasic` |
| Failed child-count lookup in list_projects | Unit | `tests/unit/error-surfacing.test.ts` | fake failing `listChildParentIds`; assert trailing unavailable note |
| Successful zero count still renders zero | Unit | `tests/unit/error-surfacing.test.ts` | control: no marker, no log on success |
| touchRetrieved fails during search_thoughts | Unit | `tests/unit/error-surfacing.test.ts` | console.error spy; read result unchanged |
| Pipeline throws during capture_thought | Unit | `tests/unit/error-surfacing.test.ts` | throwing pipeline via failing extractor deps; assert warning in confirmation; GATE 2b: removing the warning assignment reddens it |
| Pipeline throws during write_document | Unit | `tests/unit/error-surfacing.test.ts` | same |
| One reconciliation op fails | Unit | `tests/unit/error-surfacing.test.ts` | fake repo failing one archive; spy asserts reason logged; summary "1 failed" |
| One thought insert fails during freshIngest | Unit | `tests/unit/error-surfacing.test.ts` | fake ThoughtRepository failing one insert |
| Count query fails (REPO-7 envelope) | Unit | `tests/unit/error-surfacing.test.ts` | `makeFakeClient` canned error (the established repository unit harness — deterministic error injection, no fault injection needed); assert `data === null` |
| Count query succeeds with no rows | Unit | same | assert `data === 0`, `error === null` |

E2E: no user-facing happy-path workflow changes; existing `deno task test` integration suites (capture/ingest/documents) guard success-path regressions. No new E2E tests required (no UI, failure paths not reachable deterministically through the full stack without fault injection — the repository seam is the designed injection point).

Mock audit: unit tests fake only repositories/extractor deps (the seams), never the handler under test — mock-boundary compliant.
