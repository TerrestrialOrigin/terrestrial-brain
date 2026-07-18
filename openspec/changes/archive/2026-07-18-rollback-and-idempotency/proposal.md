## Why

Two mutation paths are not safe to run twice. `create_tasks_with_output` inserts task rows and then an `ai_output` row; if the output insert fails, its compensating rollback delete discards its own result and the tool unconditionally tells the caller "tasks rolled back" — so a failed rollback leaves orphaned task rows while claiming success (finding TOOL-3). The tool also has no idempotency: a client retry after the tasks were inserted but before the response arrived inserts a second full set of task rows under the same `reference_id`. Separately, six repository mutation methods (`markPickedUp`, `reject`, and four plain `archive`/`archiveMany` methods) stamp their timestamp columns unconditionally, so a retried at-least-once call re-stamps `picked_up_at` / `rejected_at` / `archived_at` forward — corrupting the original time and, for pickup, re-surfacing an already-reported delivery in `get_recent_activity` (finding REPO-5). Both are Step 15 of `codeEval/Fable20260717RemediationPlan.md`.

## What Changes

- `create_tasks_with_output`: when the `ai_output` insert fails after tasks were inserted, capture and check the compensating `deleteByIds` result; on rollback failure report the WARNING-with-orphaned-ids form (matching `insertTasksAtomically`) instead of falsely claiming "tasks rolled back". Extract the shared rollback-and-report logic into one helper used by both rollback sites (rule of three).
- `create_tasks_with_output`: add idempotency — before inserting, look up existing tasks for the `file_path` (`reference_id`); if present, do not insert a duplicate set. Document the runs-twice / crashes-halfway / interleaves reasoning inline.
- Repository mutation methods become claim-style (compare-and-set) so a re-run is a no-op instead of a re-stamp:
  - `markPickedUp` adds `.eq("picked_up", false)`
  - `reject` adds `.eq("rejected", false)`
  - `task-repository.archive` and `archiveMany`, `person-repository.archive`, `thought-repository.archive` each add `.is("archived_at", null)` — matching the existing `archiveIfActive` / `archiveManyActive` pattern.
- No schema change and no new migration — these are query-filter and handler-logic changes only.

## Capabilities

### New Capabilities
- `idempotent-mutations`: retried repository mutation methods and `create_tasks_with_output` are safe to run more than once — timestamp columns are not re-stamped and task rows are not double-inserted on a retry.

### Modified Capabilities
- `ai-output`: the `create_tasks_with_output atomic task creation` requirement is extended to cover the post-task `ai_output`-insert-failure rollback path reporting its outcome truthfully (WARNING on failed rollback), and a new requirement adds retry idempotency for the tool. Path: `openspec/specs/ai-output/spec.md`.

## Non-goals

- No optimistic-concurrency / version-column work on read-modify-write paths — that is Step 17 (`update_thought` concurrency, TOOL-6), tracked separately.
- No partial-unique-index or 23505-recovery dedup work — that was Step 5 / Step 11.
- No changes to the `insertTasksAtomically` mid-loop rollback path, which already checks its rollback error correctly; this change only reuses its reporting shape.

## Impact

- Code: `supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts` (`create_tasks_with_output` handler + shared rollback helper), `repositories/supabase-ai-output-repository.ts` (`markPickedUp`, `reject`), `repositories/supabase-task-repository.ts` (`archive`, `archiveMany`), `repositories/supabase-person-repository.ts` (`archive`), `repositories/supabase-thought-repository.ts` (`archive`).
- Tests: Deno integration tests against the real Supabase stack (mock-boundary rule — idempotency/rollback exercised through real repository code + DB), one per repository method (call twice, timestamp from call 1 unchanged) and the two `create_tasks_with_output` behaviors (failed-rollback WARNING, retry no double-insert).
- APIs/systems: no external API or schema change; the pull-API `get_recent_activity` behavior is corrected (already-reported deliveries no longer re-surface after a retried pickup).
