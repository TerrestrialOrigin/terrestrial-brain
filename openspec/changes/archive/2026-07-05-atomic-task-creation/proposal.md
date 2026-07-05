## Why

`create_tasks_with_output` inserts task rows one-by-one in a loop with no rollback: if the Nth insert fails, tasks 1..N-1 are left orphaned in the database (the only rollback covers the later `ai_output` insert). Separately, a `parent_index` that points forward (to a not-yet-inserted task) or at itself/a cycle is silently resolved to `null`, dropping the intended subtask hierarchy with no error to the caller. Both are data-integrity defects (finding C4) that produce partial, silently-wrong state.

## What Changes

- **Validate `parent_index` up front**: before any insert, every task's `parent_index` MUST refer to an *earlier* index in the array. Forward references, self-references, and out-of-range indices are rejected with a clear error and **zero rows created**. This structurally forbids cycles, so hierarchy is never silently dropped.
- **Roll back on mid-loop failure**: if any task insert fails partway through the loop, the already-inserted task rows are deleted before the error is returned, so a failed call leaves no orphaned tasks.
- **Retire the magic depth cap**: with upfront validation guaranteeing a strictly-decreasing parent chain, the `depth > 10` circular-ref guard in `computeTaskDepth` (`ai_output.ts:37`) is no longer load-bearing. Replace it with a named constant documenting it as a defensive bound (cycles are now impossible by construction).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `ai-output`: the `create_tasks_with_output` tool gains explicit requirements for atomic task creation (all-or-nothing on failure) and up-front `parent_index` validation (reject forward/self/out-of-range references). `openspec/specs/ai-output/spec.md`

## Impact

- Code: `supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts` (the `create_tasks_with_output` handler and `computeTaskDepth`).
- Tests: `tests/integration/ai_output.test.ts` — new failing-first tests for forward `parent_index` rejection, mid-loop rollback, and happy-path hierarchy preservation.
- No migration, no API-surface change to callers on the happy path; the only behavioral change for callers is that previously-silent bad input now returns an explicit error instead of partial state.

## Non-goals

- Not moving the whole create into a single Postgres RPC/transaction. Design.md records this trade-off: application-level validate-then-rollback is chosen over a stored procedure for this step to keep the DB surface small and the logic testable in TypeScript; true single-statement atomicity via RPC is noted as a future option.
- Not changing the markdown generation, project/person name resolution, or the tool's description policy.
- Not touching the unrelated `handleIngestNote`/`update_document` delete paths (covered by Step 4).
