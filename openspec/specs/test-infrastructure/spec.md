# test-infrastructure Specification

## Purpose
Defines the conventions and tooling the backend (Deno) test suite runs through:
shared MCP test-client helpers, the unit/integration test-tree split,
self-contained fixture + cleanup rules, and the `deno.json` task interface.
## Requirements
### Requirement: Shared MCP test-client helpers

The test suite SHALL obtain its MCP-calling helpers (`callTool`, `callToolRaw`, `callHTTP`) and its Supabase connection constants (base function URL, service-role key, access key) from a single shared module, `tests/helpers/mcp-client.ts`. No integration test file SHALL define its own inline copy of these helpers or re-declare the URL/key constants.

The extracted helpers SHALL be behaviorally identical to the copies they replace: `callTool` returns the tool's text content and throws on `isError`; `callToolRaw` returns `{ text, isError }` without throwing; `callHTTP` posts to a named HTTP sub-route and returns its response. SSE (`event:`/`data:`) responses SHALL be parsed exactly as before.

#### Scenario: A single shared helper module exists

- **WHEN** the test tree is inspected
- **THEN** exactly one file, `tests/helpers/mcp-client.ts`, exports `callTool`, `callToolRaw`, and `callHTTP`
- **AND** it exports the shared `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and MCP base-URL / access-key constants

#### Scenario: No integration file redefines the helpers

- **WHEN** the integration test files are searched for `function callTool`, `function callToolRaw`, or `function callHTTP` definitions
- **THEN** no matches are found — every integration file imports them from `tests/helpers/mcp-client.ts`

#### Scenario: Extracted helpers preserve behavior

- **WHEN** the full integration suite runs against the local Supabase stack after the extraction
- **THEN** it passes with the same or higher real-assertion count than before the extraction, with zero failures and zero skips

### Requirement: Self-contained, order-independent tests

Every test SHALL create its own uniquely-named fixtures and SHALL clean them up in a `try/finally` block (or an equivalent `withFixture` helper) so cleanup runs even when the test body fails. No test SHALL depend on module-level mutable state populated by an earlier test, and no test file SHALL require a specific execution order.

#### Scenario: Any single test file runs standalone

- **WHEN** any one integration test file is run in isolation (e.g. `deno test --allow-net --allow-env tests/integration/projects.test.ts`)
- **THEN** every test in that file passes without depending on another file or an earlier test having run first

#### Scenario: Fixtures are cleaned up on failure

- **WHEN** a test that creates fixtures fails partway through its body
- **THEN** the `finally` block still deletes the fixtures it created, so archived/orphaned rows do not accumulate across runs

### Requirement: No vacuous cleanup tests

The suite SHALL NOT contain placeholder test cases whose only assertion is `assertEquals(true, true)`. Cleanup logic SHALL live in `try/finally` blocks (or real teardown tests that assert their deletions succeeded), not in standalone pseudo-tests that inflate the pass count.

#### Scenario: No `assertEquals(true, true)` remains

- **WHEN** the entire `tests/` tree is searched for `assertEquals(true, true)`
- **THEN** no matches are found

### Requirement: Unit and integration tests are separated

Pure, deterministic unit tests (no database, no network, no LLM) SHALL live under `tests/unit/`, and tests that exercise the live Supabase stack SHALL live under `tests/integration/`. No `*.test.ts` files (other than the pre-existing `name-matching.test.ts` and `validators.test.ts`) SHALL live inside the Edge Function source tree.

#### Scenario: Unit tests run without the stack

- **WHEN** `deno task test:unit` is run with no Supabase stack available
- **THEN** the unit tests under `tests/unit/` pass on their own (they perform no DB/network calls)

#### Scenario: No relocated test file lives in the source tree

- **WHEN** `supabase/functions/terrestrial-brain-mcp/extractors/` is inspected
- **THEN** `project-extractor.test.ts` is no longer present there; its content lives under `tests/unit/`

### Requirement: Deno test tasks and correct documentation

Root `deno.json` SHALL define a `tasks` block with `test` (whole tree), `test:unit` (`tests/unit/`), and `test:integration` (`tests/integration/`). The README SHALL document the correct Deno test command, not the incorrect `npx vitest run`.

#### Scenario: Deno tasks exist and run the right trees

- **WHEN** `deno task test`, `deno task test:unit`, and `deno task test:integration` are invoked
- **THEN** each runs the corresponding test tree with `--allow-net --allow-env`

#### Scenario: README shows the correct runner

- **WHEN** the README's test-running instructions are read
- **THEN** they show a `deno test --allow-net --allow-env tests/` (or `deno task test`) command and no longer reference `npx vitest run`

### Requirement: Default test suite runs deterministically without a live LLM key

The default test suite (`deno task test`, `test:unit`, `test:integration`) SHALL
run against the deterministic `FakeAiProvider` (selected by `TB_AI_PROVIDER=fake`
in the test stack) and SHALL pass with NO `OPENROUTER_API_KEY` set. The suite
SHALL contain no LLM-availability hedges — no assertion guarded by a conditional
such as `if (!result.includes("No thoughts found"))` or a "the LLM may or may not
be available" structure-only check. Every assertion that depends on embedding or
completion output SHALL be an unconditional (hard) assertion, so that deleting
the implementation it targets reddens it.

#### Scenario: Suite is green with no OpenRouter key

- **WHEN** the default test suite is run with `TB_AI_PROVIDER=fake` and `OPENROUTER_API_KEY` unset
- **THEN** all tests SHALL pass with zero failures and zero skips

#### Scenario: No hedged LLM conditionals remain

- **WHEN** the test sources are searched for LLM-availability hedges (`No thoughts found` guards, "may or may not be available" structure-only assertions)
- **THEN** no such conditional SHALL remain in the suite

#### Scenario: Related query finds a captured thought deterministically

- **WHEN** a thought is captured and `search_thoughts` is run with a query sharing its words, against the fake provider
- **THEN** the search SHALL return that thought (a hard assertion, not skipped when empty)

### Requirement: Opt-in live-LLM test tier

The suite SHALL provide a separate, explicitly-invoked live-LLM tier
(`deno task test:live-llm`) that exercises the real `OpenRouterAiProvider`. This
tier SHALL NOT be part of the default `deno task test`, and SHALL NOT be
implemented as a skip in the default suite. Its `OPENROUTER_API_KEY` requirement
SHALL be documented in the README.

#### Scenario: Live tier is separate from the default suite

- **WHEN** `deno task test` is run
- **THEN** it SHALL NOT execute the live-LLM tier

#### Scenario: Live tier fails loudly without a key

- **WHEN** `deno task test:live-llm` is run with `OPENROUTER_API_KEY` unset
- **THEN** the live provider SHALL throw a clear error naming `OPENROUTER_API_KEY` rather than skipping silently


### Requirement: A pgTAP database-test suite covers DB-level invariants and RLS denial

The repository SHALL maintain a pgTAP suite under `supabase/tests/` runnable via `supabase test db`, and it SHALL include RLS denial coverage (`supabase/tests/rls_denial.test.sql`) asserting anon/authenticated denial for every table and RPC plus a `pg_policies` scope meta-assertion. The suite SHALL pass on a freshly reset stack.

#### Scenario: The pgTAP suite runs and passes

- **WHEN** `supabase test db` runs against a freshly reset stack
- **THEN** all pgTAP files, including the RLS denial suite, report PASS with zero failures

#### Scenario: The denial suite exists

- **WHEN** the test tree is inspected
- **THEN** `supabase/tests/rls_denial.test.sql` is present and contains per-table denial, per-RPC denial, and the policy-scope meta-assertion

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
