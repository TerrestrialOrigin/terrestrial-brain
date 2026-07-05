## 1. Replicate the bug (failing tests first)

- [x] 1.1 Add integration test: `create_tasks_with_output` with a forward `parent_index` (child before parent) returns an error and creates zero task rows for that `reference_id` — assert against the DB via the service client. Confirm it FAILS against current code (today it silently nulls the parent and succeeds).
- [x] 1.2 Add integration test: `create_tasks_with_output` where task N's insert fails mid-loop (force a DB constraint violation, e.g. an invalid `assigned_to` UUID on the last task) leaves tasks 1..N-1 absent afterward. Confirm it FAILS against current code (orphans remain).
- [x] 1.3 Add integration test: self-referential / out-of-range / negative `parent_index` each rejected with no rows created.
- [x] 1.4 Add integration test (happy path, must pass before and after): valid parent→child→grandchild hierarchy creates all rows with correct `parent_id` links in the DB.

## 2. Implement the fix

- [x] 2.1 In `create_tasks_with_output` (`tools/ai_output.ts`), add an up-front validation pass over `tasks`: reject any `parent_index` that is not an integer, is negative, or is `>= index` (forward/self/out-of-range) with a clear error naming the task and returning `isError` — before any insert.
- [x] 2.2 In the insert loop, on any per-task insert error, roll back already-inserted ids (`supabase.from("tasks").delete().in("id", taskIds)`) and surface the rollback outcome in the returned error text; then return `isError`.
- [x] 2.3 Replace the magic `if (depth > 10) break;` in `computeTaskDepth` with a named `MAX_TASK_DEPTH` constant plus a comment noting validation now guarantees an acyclic, finite chain.

## 3. Verify & gate

- [x] 3.1 Run the failing tests from group 1 — confirm they now PASS; confirm removing the validation/rollback code makes them fail again (GATE 2b mutation check).
- [x] 3.2 Run the full Deno suite (`deno task test`) — zero failures, zero skips.
- [x] 3.3 Run `cd obsidian-plugin && npm test && npm run build` — zero failures (unaffected but required by the gate).
- [x] 3.4 `/opsx:verify`, then `/opsx:archive`; check off Step 6 in `codeEval/Fable20260704-fix-plan.md`; commit and open PR to `develop`.
