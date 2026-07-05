## 1. Failing tests first (replicate C6)

- [x] 1.1 Add `tests/unit/task-extractor-merge.test.ts` with a minimal fake `ExtractionContext` (a fake Supabase recording `update`/`insert` payloads and injectable `{ error }`) and the `withFetchStub` pattern from `project-extractor.test.ts`.
- [x] 1.2 Failing test: matched task with `project_id = P`, re-ingest where project inference falls to LLM and the LLM errors → assert update omits `project_id` (P preserved). Must FAIL against current code.
- [x] 1.3 Failing test: no known projects, matched task with `project_id = P` → assert `project_id` omitted (P preserved). Must FAIL against current code.
- [x] 1.4 Failing test: matched task with `due_by = D` / `assigned_to = A`, note removed them, enrichment LLM succeeds returning none → assert update sets `due_by = null` and `assigned_to = null` (cleared). Must FAIL against current code (currently never cleared).
- [x] 1.5 Failing test: same as 1.4 but enrichment LLM errors → assert `due_by`/`assigned_to` omitted (preserved).
- [x] 1.6 Failing test: matched-update Supabase write returns `{ error }` → assert `result.errors` includes a message for it. Must FAIL against current code (unchecked).
- [x] 1.7 Run the new file; confirm all new tests fail for the expected reasons (GATE 2b RED).

## 2. Implementation — availability tracking & merge

- [x] 2.1 Change `inferProjectsByContent` to return `{ ok: boolean; assignments: TaskProjectAssignment[] }` (`ok:false` on non-OK response or thrown error).
- [x] 2.2 Change `inferTaskEnrichments` to return `{ ok: boolean; enrichments: TaskEnrichment[] }` likewise.
- [x] 2.3 Phase 1: make `projectByCheckboxIndex` hold only positive `string` values; add `projectUnavailable: Set<number>`; mark unavailable for checkboxes queued for LLM project inference that stay unresolved when the call did not run with `ok:true` (LLM error OR guard-skipped / no projects). Remove the "fill missing with null" loop.
- [x] 2.4 Phase 1b: add `dateUnavailable` / `personUnavailable` sets; carry `needsDate`/`needsPerson` on `aiCandidates`; after applying enrichments, mark a still-missing field unavailable when enrichment did not run with `ok:true` (error OR skipped).
- [x] 2.5 Phase 2: build the matched-task update so each of `project_id`/`due_by`/`assigned_to` is set-to-value, omitted (unavailable), or set-to-null (available-empty) per Decision 2.

## 3. Implementation — surface write errors

- [x] 3.1 Add optional `errors?: string[]` to `ExtractionResult` in `pipeline.ts`; have `runExtractionPipeline` `console.error` any surfaced `result.errors`.
- [x] 3.2 In `TaskExtractor.extract`, collect an `errors: string[]`; check `{ error }` on Phase 2 update, Phase 4 parent-link update, Phase 5 archive update (Phase 3 insert already checked); push identifying messages; return `errors` when non-empty.

## 4. Testing & Verification

- [x] 4.1 Turn the RED tests GREEN by implementation; confirm each still fails if its merge branch is deleted (GATE 2b mutation check).
- [x] 4.2 Run full Deno suite `deno test --allow-net --allow-env tests/` (local Supabase up; `OPENROUTER_API_KEY` set) — 0 failures, 0 skips.
- [x] 4.3 Run `cd obsidian-plugin && npm test && npm run build` — green (no plugin change, confirm no regression).
- [x] 4.4 `deno lint` / `deno fmt --check` on touched files clean.
- [x] 4.5 Walk each delta-spec scenario against the implementation; `/opsx:verify`.
