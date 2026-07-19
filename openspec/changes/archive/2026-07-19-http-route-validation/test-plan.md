# Test Plan — http-route-validation

| Spec scenario | Layer | Test file | Notes |
|---|---|---|---|
| Malformed JSON → 400 | Unit + Integration | `tests/unit/http-routes.test.ts`; `tests/integration/ingest_note_route.test.ts` | RED first: today it 500s |
| Non-UUID ids element → 400, no repo call | Unit + Integration | http-routes unit; `ai_output_http.test.ts` | fake repo records calls (unit); RED first |
| Oversized ids array (101) → 400 | Unit | http-routes unit | RED first |
| Legacy missing-field messages preserved | Integration | existing `ai_output_http` / `ingest_note_route` tests | must stay green through the refactor |
| Handler throw → 500 + `error_details` logged | Unit | http-routes unit (throwing fake route, recording fake logger) | RED first: `logError` currently never called |
| Exact path matches / nested path falls through | Unit | http-routes unit (`matchHttpRoute`) | RED first vs `endsWith` |
| Ingest-note over-quota → 429 via injected gate (CORE-10) | Unit | http-routes unit (fake gate) | proves the seam |
| Retried pickup reports 0 updated | Integration | `ai_output_http.test.ts` or `rollback_and_idempotency.test.ts` extension | RED first: message currently counts `ids.length` |
| due_by / email / parent_index format rejections + accepts | Unit | `tests/unit/field-schemas.test.ts` (schema-level) | exercise the exported schemas directly |
| Wrong-typed `title` → 400 | Unit + Integration | http-routes unit; ingest_note_route addition | RED first |

Mock audit: unit fakes are repositories, logger, quota gate, and route handlers injected as data — the dispatcher, matcher, and schemas under test are real. Integration layer runs the real edge function over HTTP (this repo's E2E). GATE 2b: each RED-first case doubles as the mutation check for its guard.
