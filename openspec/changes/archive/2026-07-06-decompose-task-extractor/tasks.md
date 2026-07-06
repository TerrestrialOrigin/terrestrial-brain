## 1. Reconciliation helpers (test-first)

- [x] 1.1 Add failing unit tests in `tests/unit/task-reconciliation.test.ts` for a to-be-exported `greedyMatch(pairs, threshold)`: highest-score-first wins a contested task, below-threshold pairs excluded, disjoint pairs all accepted, empty input → empty result (confirm they fail RED because `greedyMatch` is not yet exported)
- [x] 1.2 Extract and EXPORT `greedyMatch(pairs: ScoredPair[], threshold: number): ScoredPair[]` from the duplicated sort-then-one-to-one loops in `reconcileCheckboxes`; rewire both the similarity pass and the containment pass to build `ScoredPair[]` and call it; confirm 1.1 goes GREEN
- [x] 1.3 Add unit tests for `computeSimilarity` and containment score at the threshold boundaries (0.79/0.80/0.81 and 0.84/0.85/0.86), and for `stripMarkersForComparison` and `extractAssignment` (marker stripping + owner/assignee variants)

## 2. LCS prefilters (behavior-preserving perf)

- [x] 2.1 Add cheap prefilters before the character-level LCS in reconciliation: exact normalized equality (fast accept), length-ratio bound for the similarity pass, and a token-set overlap gate — each a necessary condition for clearing the threshold so pruned pairs provably score below it
- [x] 2.2 Add a prefilter-equivalence unit test: for a spread of checkbox/task pairs, assert the prefiltered reconciler returns the identical matched set as a brute-force full-LCS reference (no behavior change)

## 3. Decompose `TaskExtractor.extract`

- [x] 3.1 Introduce the internal `EnrichedCheckbox` type and replace the three parallel `Map`s (`contentByIndex`, `dueDateByIndex`, `assignedToByIndex`) and the three `*Unavailable` `Set`s with one `EnrichedCheckbox[]` keyed by checkbox index, preserving the exact C6 preserve-vs-clear merge semantics
- [x] 3.2 Extract `resolveProjects(...)` (heading > pipeline reference > AI inference, with the `projectUnavailable` bookkeeping) as a private method under ~50 lines
- [x] 3.3 Extract `enrichDatesAndAssignments(...)` (regex/fast-path date + assignment, AI batch enrichment, `date/personUnavailable` bookkeeping) as a private method under ~50 lines
- [x] 3.4 Extract `updateMatchedTasks(...)`, `createNewTasks(...)`, `fixParentLinks(...)`, `archiveRemovedTasks(...)` as private methods; reduce `extract` to an orchestrator that calls reconcile → resolve → enrich → the four write phases and assembles the result
- [x] 3.5 Fold `parent_id` into the matched-task update in `updateMatchedTasks` when the parent id is already known; keep `fixParentLinks` only for matched tasks whose parent id was not yet known at update time; ensure every write (matched update, parent update, insert, archive) still checks `error` and pushes to `errors`

## 4. Verification

- [x] 4.1 Confirm no method in `task-extractor.ts` exceeds ~50 lines (spot-check with a line count / manual review)
- [x] 4.2 Run the full Deno unit suite (`tests/unit/`) — new reconciliation tests plus the untouched `task-extractor-merge.test.ts` all green
- [x] 4.3 Run the Deno integration suite (`tests/integration/`, local Supabase stack) — `extractors.test.ts` re-ingest idempotency and `tasks.test.ts` parent hierarchy green **without modification**; zero failures, zero skips
- [x] 4.4 Run `cd obsidian-plugin && npm test && npm run build` — green (no cross-package regression)
- [x] 4.5 `deno lint` / `deno fmt --check` clean on the changed files; `/opsx:verify`, then archive
