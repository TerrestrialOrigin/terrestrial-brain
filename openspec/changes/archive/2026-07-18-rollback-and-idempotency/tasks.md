## 1. Repository idempotency — failing tests first (REPO-5)

- [x] 1.1 Add an integration test (tests/integration/) that inserts an `ai_output` row, calls `markPickedUp` twice, and asserts `picked_up_at` after call 2 equals the value after call 1. Confirm it fails RED against current code (unconditional re-stamp).
- [x] 1.2 Add an integration test that calls `reject` twice on one output and asserts `rejected_at` is unchanged after call 2. Confirm RED.
- [x] 1.3 Add integration tests that archive twice via `task-repository.archive`, `task-repository.archiveMany` (mixed already-archived ids), `person-repository.archive`, and `thought-repository.archive`, each asserting `archived_at` is unchanged after the second call. Confirm each RED.

## 2. Repository idempotency — implement claim-style filters

- [x] 2.1 `supabase-ai-output-repository.ts` `markPickedUp`: add `.eq("picked_up", false)`.
- [x] 2.2 `supabase-ai-output-repository.ts` `reject`: add `.eq("rejected", false)`.
- [x] 2.3 `supabase-task-repository.ts` `archive` and `archiveMany`: add `.is("archived_at", null)`.
- [x] 2.4 `supabase-person-repository.ts` `archive`: add `.is("archived_at", null)`.
- [x] 2.5 `supabase-thought-repository.ts` `archive`: add `.is("archived_at", null)`.
- [x] 2.6 Re-run the Task-1 tests; confirm all now GREEN. GATE 2b: revert one filter, confirm its test re-reddens, restore.

## 3. create_tasks_with_output rollback honesty + idempotency — failing tests first (TOOL-3)

- [x] 3.1 Add a unit test (tests/unit/) for the extracted `rollbackInsertedTasks` helper with a fake `TaskRepository`: when `deleteByIds` errors, assert the returned note contains the WARNING-with-orphaned-ids form and does NOT claim "rolled back"; when it succeeds, assert the clean "rolled back" form. (No DB constraint can force the ai_output-insert + failed-delete path in integration, so per TOOL-3's fix guidance this behavior is unit-tested with a fake.) Confirm the WARNING assertion fails RED before the helper exists / before the handler uses it.
- [x] 3.2 Add an integration test that calls `create_tasks_with_output` twice with the same `file_path` and asserts the second call returns a clear "tasks for this file_path already exist" error and that the task-row count for that `reference_id` is unchanged. Confirm RED.

## 4. create_tasks_with_output — implement

- [x] 4.1 Extract the "delete inserted task ids, check the delete's error, return WARNING-with-orphaned-ids or clean rolled-back note" logic from `insertTasksAtomically` into one shared helper (e.g. `rollbackInsertedTasks(taskRepository, taskIds)`); rewire `insertTasksAtomically` to use it (behavior unchanged).
- [x] 4.2 In the `create_tasks_with_output` handler, replace the unchecked `await taskRepository.deleteByIds(taskIds)` at the `ai_output`-insert-failure site with a call to the shared helper, so a failed rollback reports the WARNING.
- [x] 4.3 Add the idempotency pre-check: before `insertTasksAtomically`, call `taskRepository.findByReference(file_path)`; if it returns rows, return `errorResult` stating tasks for that `file_path` already exist. Add the three-questions (runs-twice/crashes-halfway/interleaves) inline comment per design.md.
- [x] 4.4 Re-run the Task-3 tests; confirm GREEN. GATE 2b: revert each fix in turn, confirm the matching test re-reddens, restore.

## 5. Gates & verification

- [x] 5.1 Reset the stack (`npx supabase db reset`) and run the full Deno suite (`deno task test`) against it; confirm 0 failures, 0 skips; paste the summary line.
- [x] 5.2 Run `cd obsidian-plugin && npm test && npm run build` (unaffected by this change, but required by the gate); confirm green.
- [x] 5.3 Run `npm run validate` / `scripts/validate-all.sh`; confirm green. Update the validate script only if this change added a new test target.
- [x] 5.4 Walk each delta-spec scenario (ai-output + idempotent-mutations) and confirm the implementation handles it.
