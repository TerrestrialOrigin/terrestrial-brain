## 1. Baseline

- [x] 1.1 Record the current suite baseline: run `deno test --allow-net --allow-env tests/` and capture the pass count and any pre-existing failures/skips; count `Deno.test(` occurrences per file and grep-count `assertEquals(true, true)` so before/after can be compared.

## 2. Shared helper module

- [x] 2.1 Create `tests/helpers/mcp-client.ts` exporting `callTool`, `callToolRaw`, `callHTTP` and the constants `MCP_BASE`, `MCP_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, plus `serviceHeaders()`/`restUrl()` convenience for direct REST verification — behavior byte-for-byte identical to the existing inline copies (SSE + JSON handling, `isError` throw semantics).
- [x] 2.2 Add a small `withFixture`/`uniqueName` utility (unique token from a counter + `crypto.randomUUID()`) for self-contained fixtures.

## 3. Swap inline helpers for imports

- [x] 3.1 Replace the inline helpers/constants in each of the 8 integration files with imports from `tests/helpers/mcp-client.ts`: `ai_output.test.ts`, `ai_output_http.test.ts`, `projects.test.ts`, `queries.test.ts`, `tasks.test.ts`, `thoughts.test.ts`, `enhanced_ingest.test.ts`, `documents.test.ts`. Run each file individually after its swap to confirm green.
- [x] 3.2 Verify `grep -rn "function callTool\|function callToolRaw\|function callHTTP" tests/integration/` returns nothing.

## 4. Self-contained, order-independent tests

- [x] 4.1 Rewrite `projects.test.ts`: remove the module-level `testProjectId`; each test creates its own uniquely-named project and archives it in `finally`; fold the parent/child lifecycle chain into a single self-contained test; rewrite the "hides archived by default" assertion to reference the unique fixture the same test archived.
- [x] 4.2 Rewrite `tasks.test.ts` the same way: remove module-level `testTaskId`; per-test unique fixtures + `finally` cleanup; "hides archived by default" checks the test's own fixture.
- [x] 4.3 Remove the cross-test order-dependence chain in `thoughts.test.ts` (around the eval's line 738-741) — make the involved tests create and clean up their own fixtures.
- [x] 4.4 Confirm each rewritten file passes when run standalone (`deno test --allow-net --allow-env tests/integration/<file>`).

## 5. Remove vacuous cleanup tests

- [x] 5.1 Delete the 3 `assertEquals(true, true)` cleanup pseudo-tests in `enhanced_ingest.test.ts`, folding any real teardown into the owning tests' `finally` blocks.
- [x] 5.2 Delete the 2 `assertEquals(true, true)` cleanup pseudo-tests in `extractors.test.ts`, folding teardown into `finally`.
- [x] 5.3 Verify `grep -rn "assertEquals(true, true)" tests/` returns nothing.

## 6. Unit/integration split

- [x] 6.1 Create `tests/unit/` and move `parse.test.ts` there (fix relative import paths to `supabase/functions/...`); confirm it runs with no stack.
- [x] 6.2 Split the pure-helper tests out of `extractors.test.ts` into a file under `tests/unit/` (move `Deno.test` blocks verbatim; leave live-DB tests in `tests/integration/`); confirm total test count is unchanged.
- [x] 6.3 Relocate `supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.test.ts` into `tests/unit/`, rewriting the `(globalThis as any).Deno` shim as a plain Deno test; confirm no `.test.ts` for project-extractor remains in the source tree.

## 7. Tasks & docs

- [x] 7.1 Add the `tasks` block (`test`, `test:unit`, `test:integration`) to root `deno.json`.
- [x] 7.2 Fix the README test command (replace `npx vitest run` with `deno test --allow-net --allow-env tests/` / `deno task test`).

## 8. Testing & Verification

- [x] 8.1 Run `deno task test:unit` and confirm it passes (no DB/network needed).
- [x] 8.2 Run `deno task test` (full tree) against the local Supabase stack; confirm zero failures, zero skips, and pass/assertion count ≥ the Task 1.1 baseline.
- [x] 8.3 Run `deno task test:integration` and 3 individual files (`projects`, `tasks`, `thoughts`) standalone; all green.
- [x] 8.4 Run the plugin gate (`cd obsidian-plugin && npm test && npm run build`) to confirm no collateral breakage.
- [x] 8.5 Final grep gates: no `assertEquals(true, true)` in `tests/`; no helper definitions in `tests/integration/`; README shows the Deno command.
- [x] 8.6 `/opsx:verify`, then `/opsx:archive`; commit; open PR to `develop`; check off Step 5 in `codeEval/Fable20260704-fix-plan.md`.
