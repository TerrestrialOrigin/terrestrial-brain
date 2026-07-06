# Design — Decompose & harden the task extractor

## Context

`TaskExtractor.extract` (`supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts`) runs on every `ingest_note` call. It currently:

- Is a single ~245-line method with five inline `--- Phase N ---` comment banners.
- Threads per-checkbox resolution state through three parallel `Map<number, string>` structures (`contentByIndex`, `dueDateByIndex`, `assignedToByIndex`) plus three companion `Set<number>` (`projectUnavailable`, `dateUnavailable`, `personUnavailable`) — six loosely-coupled containers all keyed by the same checkbox index.
- Reconciles new checkboxes against existing tasks with `reconcileCheckboxes`, which runs a character-level longest-common-subsequence DP twice (a similarity pass at threshold 0.8, then a containment fallback at 0.85). The DP is `O(lenA × lenB)` per pair and is run over every `checkbox × task` combination, i.e. `O(checkboxes × tasks × len²)`, twice. On a large note this can exhaust the edge-function CPU budget.
- Writes `parent_id` for matched tasks in a **second** per-task `update` (Phase 4) even though the parent is usually already known when the matched task is written in Phase 2.

Merge semantics (C6/Step 8), timezone-correct dates (Step 9), the `AiProvider` seam (Step 15), and the `TaskRepository` seam (Step 16) already landed — this change builds on them and must not alter their behavior.

## Goals / Non-Goals

**Goals**
- No method in `task-extractor.ts` exceeds ~50 lines; `extract` becomes a readable orchestrator.
- Per-checkbox state lives in one `EnrichedCheckbox` object, not six parallel containers.
- `greedyMatch` is a single exported, unit-tested helper used by both reconciliation passes.
- The LCS runs only on pairs that could plausibly clear the threshold; large notes stay within CPU budget.
- Matched tasks are written once when their parent is already known.

**Non-Goals**
- No change to which tasks match, which fields are written, or any LLM prompt (pure refactor).
- No new AI stub (Step 22), no schema/migration change, no plugin change.

## Decisions

### D1: One `EnrichedCheckbox[]` replaces the six parallel containers

Introduce an internal type carrying every per-checkbox resolution outcome:

```ts
interface EnrichedCheckbox {
  index: number;
  content: string;                 // cleaned task content
  projectId: string | null;        // resolved project, or null
  dueDate: string | null;
  assignedTo: string | null;
  projectUnavailable: boolean;     // resolution could not complete → preserve stored value
  dateUnavailable: boolean;
  personUnavailable: boolean;
}
```

`resolveProjects(...)` and `enrichDatesAndAssignments(...)` each return/populate this array; `updateMatchedTasks`, `createNewTasks` read from it. The `*Unavailable` booleans keep the exact C6 merge semantics already specced (available-empty → clear; unavailable → preserve) — they move from three `Set`s onto the struct with identical meaning.

**Alternative considered:** keep the maps but wrap in a small accessor object. Rejected — it hides the same six-container smell behind indirection without making the data-flow legible.

### D2: `greedyMatch(pairs, scoreFn, threshold)` — one exported helper for both passes

Both passes today: score every candidate pair, sort descending by score, then walk the sorted list assigning each checkbox/task at most once. Extract:

```ts
export interface ScoredPair { checkboxIndex: number; taskId: string; score: number; }
export function greedyMatch(
  pairs: ScoredPair[],
  threshold: number,
): ScoredPair[]  // returns accepted pairs, highest-score-first, strictly one-to-one
```

The similarity pass and the containment pass differ only in (a) which score function feeds the pairs and (b) the threshold — so the caller builds the `ScoredPair[]` (applying its prefilter + score) and hands them to `greedyMatch`. Exporting it makes the one-to-one/highest-first invariant directly unit-testable, which the eval called out as a silently-regressing surface.

**Alternative considered:** a full optimal (Hungarian) assignment. Rejected — behavior change; the current greedy is the specced behavior and we are preserving it, not improving match quality.

### D3: Cheap prefilters gate the LCS — correctness-preserving

The containment/similarity scores are `lcs / maxLen` (similarity) and `lcs / minLen` (containment). Because `lcs ≤ min(lenA, lenB)`, we can cheaply upper-bound the score and skip the DP when the bound is already below the threshold:

- **Exact normalized equality** → score 1.0, skip DP (fast accept).
- **Length-ratio bound (similarity):** `lcs/maxLen ≤ minLen/maxLen`. If `minLen/maxLen < 0.8`, the pair *cannot* reach the similarity threshold → skip DP. (For containment the analogous bound `lcs/minLen ≤ 1` is trivial, so length-ratio does not prune containment; token Jaccard does.)
- **Token-set Jaccard lower gate:** shared-token overlap is a cheap necessary condition; a pair with near-zero token overlap cannot reach 0.8/0.85. Use a conservative gate so we only skip pairs provably below threshold.

Every prefilter is a **necessary** condition for clearing the threshold, so a skipped pair is guaranteed to have scored below threshold anyway — the accepted set is identical to today's. The re-ingest idempotency integration tests (which exercise real match/no-match boundaries) are the proof and must stay green untouched.

**Alternative considered:** cap note size / task count. Rejected — silently drops data; the owner's rule forbids silent truncation.

### D4: Fold `parent_id` into the matched-task update

In `updateMatchedTasks`, when the checkbox's `parentIndex` resolves to an already-known task id, include `parent_id` in that single `update`. The existing Phase 4 (`fixParentLinks`) is retained but only issues an update for matched tasks whose parent id was **not** yet known at Phase 2 time (parent is itself a newly-created task from Phase 3). This removes the redundant second write in the common case while preserving the write-error-surfacing requirement (any parent write, wherever issued, still checks `error` and pushes to `errors`).

## Risks / Trade-offs

- **[Prefilter prunes a pair that would have matched]** → Each prefilter is a proven necessary condition (score upper-bounded below threshold). Mitigation: unit tests on the threshold boundaries (0.79/0.80/0.81 and 0.84/0.85/0.86) plus the untouched integration idempotency suite; if any integration re-ingest test changes result, that is a red flag to stop and investigate (per Step 19 acceptance).
- **[Parent-link fold changes ordering so a parent link is missed]** → Keep Phase 4 as the catch-all for parents resolved after the matched write; add/keep an integration test that re-ingests a subtree and asserts `parent_id` is set.
- **[Decomposition accidentally drops the `*Unavailable` bookkeeping]** → The merge-semantics unit tests (`task-extractor-merge.test.ts`, 521 lines) already pin preserve-vs-clear per field and must stay green untouched.

## Test Strategy

Repo has **no terrestrial-core dependency**; the test layers here are the Deno suite (`tests/`) and the obsidian-plugin vitest suite. This change touches only the Deno edge-function extractor, so:

- **Unit (new):** exported `greedyMatch` (one-to-one, highest-first, threshold gating, empty input); `computeSimilarity` and containment score at threshold boundaries; `stripMarkersForComparison`; `extractAssignment` — added to `tests/unit/` (extend `extractor-helpers.test.ts` or a focused `task-reconciliation.test.ts`). A prefilter-equivalence test: for a spread of pairs, assert the prefiltered reconciler returns the identical matched set as a brute-force reference.
- **Unit (kept, untouched):** `task-extractor-merge.test.ts` — the C6 preserve/clear semantics.
- **Integration (kept, untouched):** `tests/integration/extractors.test.ts` re-ingest idempotency — the primary safety net; must stay green with no edits. `tasks.test.ts` for parent hierarchy.
- **No E2E layer applies** — the extractor is server-internal and has no plugin/browser surface; the plugin vitest + build still run as a gate to confirm no cross-package breakage.

**User error scenarios** (this is an internal transform driven by note content, not direct user input):
- Duplicate/near-duplicate checkboxes in one note → greedy one-to-one still assigns each existing task at most once (no double-match). Covered by a `greedyMatch` unit test.
- A checkbox indented under a parent that is itself new → parent link resolved via retained Phase 4. Covered by integration.
- Empty note / no checkboxes → early return, no DB writes (unchanged).

**Security analysis:** No new external input, no new endpoint, no new dependency, no secret handling. The perf prefilters *reduce* a DoS-style CPU-exhaustion surface (a maliciously large note forcing quadratic-in-length LCS across many pairs) — a defensive improvement. All DB access remains behind the existing `TaskRepository` seam (no new raw `supabase.from`). No `ThreatModel.md` change beyond noting the CPU-budget hardening.

## Migration Plan

Pure code refactor inside one file plus new unit tests. No DB migration, no config, no data backfill. Deploy = redeploy the edge function. Rollback = revert the commit; no state to unwind.

## Open Questions

None — scope is fully determined by the fix-plan Step 19 acceptance criteria.
