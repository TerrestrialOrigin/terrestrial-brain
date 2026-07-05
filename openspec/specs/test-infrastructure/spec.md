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
