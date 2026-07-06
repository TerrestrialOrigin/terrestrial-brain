## Why

`TaskExtractor.extract` is a ~245-line method with five literal `--- Phase N ---` comments, three parallel index-keyed `Map`s plus their `*Unavailable` companion `Set`s, and a two-pass reconciliation that runs a character-level LCS (`O(checkboxes × tasks × len²)`) twice with no cheap prefilters — a shape that both violates the short-single-purpose-function rule and can exhaust the Supabase edge-function CPU budget on large notes. This is fix-plan Step 19 (finding X3, extractor half).

## What Changes

- **Decompose `TaskExtractor.extract`** into one private method per phase — `resolveProjects`, `enrichDatesAndAssignments`, `updateMatchedTasks`, `createNewTasks`, `fixParentLinks`, `archiveRemovedTasks` — each under ~50 lines, with `extract` reduced to an orchestrator.
- **Replace the three parallel `Map`s** (`contentByIndex`, `dueDateByIndex`, `assignedToByIndex`) and their `*Unavailable` `Set`s with a single `EnrichedCheckbox[]` structure keyed by checkbox index, so per-checkbox resolution state travels as one object.
- **Extract and EXPORT `greedyMatch(pairs, scoreFn, threshold)`** — the highest-score-first, one-to-one assignment loop currently duplicated across the similarity and containment passes of `reconcileCheckboxes` — and cover it with unit tests.
- **Add cheap prefilters before the LCS** (exact normalized equality, length-ratio bound, token-set Jaccard) so the expensive DP runs only on plausible pairs. Behavior (which pairs match at the 0.8/0.85 thresholds) is preserved; only pairs that could not clear the threshold are skipped early.
- **Fold the parent-link write into the matched-task update** (Phase 2) when the parent id is already known, eliminating the redundant second per-task `update` that Phase 4 performs; Phase 4 handling remains only for parents resolved after the matched task was written.
- **New unit tests** for the exported reconciliation helpers: `greedyMatch` one-to-one/highest-first behavior, `computeSimilarity` and containment threshold boundaries (0.8 / 0.85), `stripMarkersForComparison`, `extractAssignment`.

This is a pure refactor + performance hardening — **zero behavior change intended**. No new user-facing capability.

## Non-goals

- No change to merge semantics (finding C6 / Step 8 already landed), due-date/timezone handling (Step 9), or the AI-provider seam (Step 15).
- No change to the LLM prompts or the fields written to the `tasks` table.
- Not introducing a stub AI provider (that is Step 22) — the existing integration suite remains the safety net and must stay green untouched.

## Capabilities

### New Capabilities
- _(none)_

### Modified Capabilities
- `task-extractor` (`openspec/specs/task-extractor/spec.md`): add an explicit **Task reconciliation matching** requirement that pins the reconciliation contract the perf prefilters must preserve — two-pass (similarity ≥ 0.8, then containment ≥ 0.85), greedy highest-score-first, strictly one-to-one between checkboxes and existing tasks — so the added prefilters cannot silently change which tasks match. The existing "Extraction surfaces Supabase write failures" requirement continues to hold with the parent-link write folded into the matched-task update path.

## Impact

- `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts` — internal decomposition, new `EnrichedCheckbox[]`, exported `greedyMatch`, LCS prefilters, parent-link fold.
- `tests/unit/extractor-helpers.test.ts` (or a new `tests/unit/task-reconciliation.test.ts`) — new helper unit tests.
- `tests/integration/extractors.test.ts` — must remain green **without modification** (idempotency/re-ingest is the safety net).
- No migration, no plugin, no API-contract change.
