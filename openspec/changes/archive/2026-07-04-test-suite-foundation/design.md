## Context

The Deno integration suite (`tests/integration/*.ts`, ~7,000 lines) is real (HTTP → edge function → Postgres, zero mocks on tested paths) but was assembled by copy-paste. Concretely:

- The `callTool` helper is inlined in 8 files; `callHTTP` in 4; `callToolRaw` in 1; plus repeated `const BASE = "http://localhost:54321/functions/v1/terrestrial-brain-mcp?key=dev-test-key-123"` and hardcoded service-role JWTs.
- `projects.test.ts` and `tasks.test.ts` share a module-level `let testProjectId`/`testTaskId` set by the first `Deno.test` and read by later ones — Deno runs tests in file order so this "works", but no test runs standalone, and the "hides archived by default" tests assert a fixture name is *absent*, which also silently depends on prior runs having archived their leftovers. `thoughts.test.ts:738-741` has a similar cross-test chain.
- Cleanup is faked: `assertEquals(true, true)` cases (3 in `enhanced_ingest.test.ts`, 2 in `extractors.test.ts`) exist only to run teardown code as a "test", inflating the pass count and orphaning rows when an earlier test throws before registering its id.
- `parse.test.ts` is entirely pure (no DB/network) yet sits in `tests/integration/`; `extractors.test.ts` mixes pure helper tests with live-DB tests; and a stray `project-extractor.test.ts` lives *inside the function source tree* with a fragile `(globalThis as any).Deno` shim.
- There is no `deno.json` test task and the README says `npx vitest run` (wrong runner entirely).

**Constraints:** This is Step 5 of the remediation plan and deliberately precedes the Phase C bug fixes, so it must be a pure test-tooling change — no production behavior changes, and the LLM-dependent hedged assertions are explicitly left for Step 22. The local Supabase stack plus `OPENROUTER_API_KEY` (in `supabase/functions/.env`) remain the run prerequisites.

## Goals / Non-Goals

**Goals:**

- One shared `tests/helpers/mcp-client.ts` for `callTool`/`callToolRaw`/`callHTTP` and all URL/key constants; zero inline copies remain.
- Every integration test self-contained: unique fixture names, `try/finally` cleanup, no module-level state shared between tests, no execution-order dependence.
- No `assertEquals(true, true)` anywhere in `tests/`.
- Clean `tests/unit/` vs `tests/integration/` split; no test files in the source tree.
- `deno.json` `tasks` block (`test`, `test:unit`, `test:integration`) and a corrected README command.

**Non-Goals:**

- Touching the hedged `if (!result.includes("No thoughts found"))` LLM assertions (Step 22).
- Any change to `supabase/functions/` production code, the plugin, migrations, or dependencies (beyond relocating one stray test file).
- New behavioral coverage or CI (Step 23).
- Changing helper *behavior* — the extracted helpers must be byte-for-byte behaviorally identical to the copies.

## Decisions

### D1: Single helper module `tests/helpers/mcp-client.ts`

Export the union of all helper variants actually used: `callTool(name, args)`, `callToolRaw(name, args)`, `callHTTP(endpoint, body)`, plus constants `MCP_BASE`, `MCP_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and a `serviceHeaders()`/`restUrl()` convenience for the direct REST verification calls that several files make. The `callTool` implementations across files are already identical modulo comments, so extraction is a straight de-duplication with no behavior change.

*Alternative considered:* a class-based client. Rejected — the free-function shape matches the existing call sites exactly, so replacing 13 copies stays mechanical and low-risk.

### D2: `withFixture` / `try/finally` for self-containment

Add a tiny `withFixture` helper (or inline `try/finally`) so each test creates a uniquely-named fixture (name suffixed with a per-test unique token derived from a counter + `crypto.randomUUID()` — **not** wall-clock alone, to avoid collisions) and archives/deletes it in `finally`. Lifecycle chains that genuinely test a sequence (create parent → child → get children → archive) become a *single* test that runs the sequence against its own fresh fixtures, rather than N tests sharing a module global. The "hides archived by default" assertions are rewritten to check the specific unique fixture the same test created and archived, not a shared literal name — removing both the order-dependence and the leftover-sensitivity.

*Alternative considered:* a global `beforeAll`/`afterAll`-style suite fixture. Rejected — Deno's flat `Deno.test` model plus the eval's "any single test file runs standalone via `--filter`" acceptance push toward per-test ownership.

### D3: Unit/integration split by dependency, not by file

Move `parse.test.ts` wholesale to `tests/unit/` (it's pure). For `extractors.test.ts`, split the pure-helper tests (name-matching, similarity, deterministic parsing) into `tests/unit/` and leave the live-DB extractor tests in `tests/integration/`. Relocate `supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.test.ts` into `tests/unit/`, rewriting its `(globalThis as any).Deno` env-stub shim as a normal Deno test (set the env via `Deno.env.set` in the test, or restructure so no module-level env read is needed). The two other in-source test files (`name-matching.test.ts`, `validators.test.ts`) are already clean Deno tests but sit in the source tree — moving them is **out of scope for this step** unless they block the `project-extractor.test.ts` move; the plan scopes only `project-extractor.test.ts` for relocation here.

*Trade-off:* `extractors.test.ts` is 1,960 lines; splitting it risks accidental behavior change. Mitigation: move whole `Deno.test` blocks verbatim, change only imports, and diff assertion counts before/after.

### D4: `deno.json` tasks + README fix

Add:
```jsonc
"tasks": {
  "test": "deno test --allow-net --allow-env tests/",
  "test:unit": "deno test --allow-net --allow-env tests/unit/",
  "test:integration": "deno test --allow-net --allow-env tests/integration/"
}
```
`test:unit` keeps `--allow-net --allow-env` for uniformity even though unit tests make no calls (the spec requires they pass *without* the stack, which holds because they perform no network I/O). Fix `README.md:361` from `cd tests && npx vitest run` to the Deno command / `deno task test`.

### Test Strategy

This change *is* test tooling; its "tests" are the acceptance checks in the spec, verified by running the suite and by `grep`:
- **Behavior-preservation:** run the full integration suite before and after; assertion/pass counts must not drop; zero failures, zero skips.
- **Standalone-run:** run 3 representative files (`projects`, `tasks`, `thoughts`) individually and confirm green.
- **Unit isolation:** run `deno task test:unit` and confirm it passes (it makes no DB calls by construction).
- **Grep gates:** `grep -rn "assertEquals(true, true)" tests/` → empty; `grep -rn "function callTool" tests/integration/` → empty; no `.test.ts` under the extractors source dir except the two out-of-scope pre-existing ones.

## Risks / Trade-offs

- **[Rewriting order-dependent tests changes their fixtures/assertions, risking silent loss of coverage]** → Preserve every original assertion's intent; where a shared-state chain becomes one test, keep all intermediate assertions inside it. Compare `Deno.test` counts and assertion counts before/after; the count must be equal or higher.
- **[Splitting the 1,960-line `extractors.test.ts` could drop or duplicate a block]** → Move blocks verbatim; verify total test count across `tests/unit/` + `tests/integration/` equals the original.
- **[The suite still requires `OPENROUTER_API_KEY` for LLM-touching integration tests]** → Accepted and unchanged; documented as a prerequisite until Step 22 lands the stub. The new `test:unit` task gives a key-free subset immediately.
- **[Relocating `project-extractor.test.ts` out of the source tree could change which globs pick it up]** → It is only referenced by test discovery; after the move, confirm it runs under `deno task test:unit` and no longer under any function-dir glob.

## Migration Plan

No runtime migration — test-only. Rollout: land helper module → mechanically swap each file's inline helpers for imports (running that file after each swap) → rewrite order-dependent files → delete vacuous tests / fold cleanup into `finally` → perform the unit/integration moves → add `deno.json` tasks and README fix → run the full suite + standalone-file checks + grep gates. Rollback is a plain `git revert`; nothing outside `tests/`, `deno.json`, `README.md`, and one relocated source-tree file is touched.

## Open Questions

- None blocking. The two other in-source Deno test files (`name-matching.test.ts`, `validators.test.ts`) are left in place per the plan's scope; a later hygiene step can relocate them if desired.
