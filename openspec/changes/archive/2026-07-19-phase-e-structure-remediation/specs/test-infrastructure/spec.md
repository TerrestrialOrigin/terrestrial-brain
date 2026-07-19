## ADDED Requirements

### Requirement: Legacy integration files follow the self-owned-fixture pattern

The older integration files (`documents.test.ts`, `ai_output.test.ts`, `ai_output_http.test.ts`, the archive section of `thoughts.test.ts`, `queries.test.ts`, `extractors.test.ts`, `ingest_note_route.test.ts`) SHALL follow the same self-owned-fixture rules the newer files already meet: every test creates its own uniquely-named fixtures (via `uniqueName()`), cleans up in `try/finally` (registering cleanup ids before assertions), hard-deletes rather than archives its fixtures, and depends on no module-level id populated by an earlier test. Trailing cleanup-as-a-test blocks SHALL be deleted. Fixture cleanup SHALL cover companion rows (note snapshots created by ingest, ai_output rows), not just the primary row.

#### Scenario: A migrated file runs standalone

- **WHEN** any one migrated integration file is run in isolation against a fresh stack, twice in a row without a reset between runs
- **THEN** both runs pass — no order dependence, no cross-run name collisions, no fixture accumulation that changes results

#### Scenario: Cleanup survives assertion failure

- **WHEN** a test body in a migrated file fails an assertion after creating fixtures
- **THEN** its `finally` block still deletes the fixtures it created

### Requirement: Tests never mutate global state they do not own

No test SHALL mutate rows it did not create (e.g. marking ALL pending ai_output rows picked up to manufacture an empty state). Emptiness or absence assertions SHALL be scoped to the test's own fixtures/markers.

#### Scenario: Pending-output emptiness is asserted per fixture

- **WHEN** the pull-API tests verify picked-up outputs disappear from the pending set
- **THEN** they assert the specific created id is absent, and no test fetches-and-marks all pending rows globally

### Requirement: Every assertion path always asserts

No test SHALL contain a control-flow branch on which it can pass with zero assertions executed (e.g. a try/catch where only the catch asserts). Error-behavior tests SHALL use `callToolRaw` (or equivalent) and assert the outcome deterministically on a single always-taken path.

#### Scenario: get_document error test asserts on every path

- **WHEN** the nonexistent-id `get_document` test runs
- **THEN** it asserts the not-found outcome via `callToolRaw` regardless of whether the tool errors or returns a result — a wrong success can never pass silently

### Requirement: No fixed sleeps as synchronization

Integration tests SHALL NOT use fixed `setTimeout` sleeps to wait for a condition. Timestamp-difference and eventual-state assertions SHALL use bounded condition polls or direct value comparison.

#### Scenario: updated_at difference is asserted without a sleep

- **WHEN** the document-update test verifies `updated_at` changed
- **THEN** it compares parsed timestamps (or polls bounded on the condition) with no fixed 50 ms sleep

### Requirement: Unit-style tests live in the unit tree

Tests that fake the components on the very path they exercise (mock-extractor pipeline tests, pure-function formatter tests, in-process provider tests that never touch the running stack) SHALL live under `tests/unit/`, not `tests/integration/`.

#### Scenario: Moved sections run in the unit tier

- **WHEN** `deno task test` runs
- **THEN** the pipeline mock-extractor tests, `generateTaskMarkdown` tests, and the extraction-type-allowlist coercion tests execute from `tests/unit/` and `tests/integration/` contains no section titled as unit tests

### Requirement: Extraction test contexts come from a shared factory

Integration/unit tests building an `ExtractionContext` SHALL use a shared `makeExtractionContext(overrides)` factory instead of hand-writing the full context literal, so adding a context field is a one-site change.

#### Scenario: Context literals are collapsed

- **WHEN** `extractors.test.ts` (and its moved unit portions) are inspected
- **THEN** each test builds its context via `makeExtractionContext({ … })`, overriding only the fields it cares about

### Requirement: Date fixtures are clock-derived

Due-date extraction tests SHALL derive fixture dates from the current clock (e.g. now + 30 days) and assert on the date component (`startsWith`), not on hardcoded past calendar dates or exact UTC-midnight instants. The intended UTC anchoring SHALL be pinned by one dedicated unit test in the date-parser suite.

#### Scenario: Extraction date assertions survive the calendar

- **WHEN** the date-extraction integration tests run at any future date
- **THEN** their fixture dates are in the future relative to the run and assertions match on the date component only
