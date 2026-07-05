## Why

The test suite works but was built by copy-paste: the `callTool`/`callToolRaw`/`callHTTP` helpers and the hardcoded Supabase URL/service-key constants are duplicated across 8 integration files (13 helper copies total), several tests depend on execution order and shared module state (so they cannot run individually via `--filter` and archived fixtures accumulate across runs), cleanup is faked with `assertEquals(true, true)` cases that inflate the pass count, pure unit tests live under `tests/integration/`, there is no `deno.json` test task, and the README documents the wrong test runner (`npx vitest run`). This is the foundation step that later remediation work (the Phase C bug fixes) builds on — doing it first means every subsequent fix lands on clean shared helpers and self-contained fixtures instead of adding to the copy-paste problem.

## What Changes

- Extract `tests/helpers/mcp-client.ts` exporting `callTool`, `callToolRaw`, `callHTTP`, and shared `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `MCP_BASE` / access-key constants; replace all 13 inline copies across the 8 integration test files.
- Make tests self-contained: each test creates its own uniquely-named fixtures and cleans them up in `try/finally` (or a small `withFixture` helper). Remove the order-dependence chains in `projects.test.ts`, `tasks.test.ts`, and `thoughts.test.ts` so any single test file runs standalone.
- Delete every vacuous cleanup test (`assertEquals(true, true)`): 3 in `enhanced_ingest.test.ts` and 2 in `extractors.test.ts`. Real cleanup moves into `try/finally`.
- Move pure unit tests out of `tests/integration/` into a new `tests/unit/`: `parse.test.ts` (entirely deterministic) and the non-DB half of `extractors.test.ts`. Relocate the stray in-source `supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.test.ts` into the Deno unit tree, rewriting its fragile `(globalThis as any).Deno` vitest shim as a plain Deno test.
- Add `tasks` to root `deno.json`: `test`, `test:unit`, `test:integration`. Fix the README test command (currently `npx vitest run` — wrong runner) to `deno test --allow-net --allow-env tests/`.

**Non-goals**

- **Not** touching the hedged `if (!result.includes("No thoughts found"))` LLM-dependent assertions — that is Step 22 (needs the deterministic AI stub seam that does not exist yet).
- **Not** changing any production/source code under `supabase/functions/` (except moving one stray test file out of the source tree) or the Obsidian plugin.
- **Not** adding new behavioral test coverage or a CI pipeline (CI is Step 23).
- **Not** refactoring the `callTool` helper's behavior — the extracted version must be byte-for-byte behaviorally identical to the copies it replaces.

## Capabilities

### New Capabilities
- `test-infrastructure`: Shared test-client helpers, the unit/integration test-tree split, self-contained fixture + cleanup conventions, and the `deno.json` task interface that the whole suite runs through.

### Modified Capabilities
<!-- None. This change touches only test tooling and one misplaced test file; no product spec's requirements change. -->

## Impact

- **Test files:** all 8 `tests/integration/*.ts` files that inline the helpers (`ai_output.test.ts`, `ai_output_http.test.ts`, `projects.test.ts`, `queries.test.ts`, `tasks.test.ts`, `thoughts.test.ts`, `enhanced_ingest.test.ts`, `documents.test.ts`); `parse.test.ts` moves to `tests/unit/`; `extractors.test.ts` is split; `project-extractor.test.ts` relocates from source tree to `tests/unit/`.
- **New files:** `tests/helpers/mcp-client.ts`, `tests/unit/` tree.
- **Config:** root `deno.json` gains a `tasks` block.
- **Docs:** `README.md` test-command section.
- **No production code, no migrations, no dependencies changed.** The existing local Supabase stack (`npx supabase start`) plus `OPENROUTER_API_KEY` in `supabase/functions/.env` remain the run prerequisites (LLM-key removal is Step 22).
