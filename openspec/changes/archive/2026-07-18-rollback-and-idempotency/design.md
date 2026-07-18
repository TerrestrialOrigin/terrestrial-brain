## Context

The MCP server exposes an at-least-once pull API (the desktop client re-issues `mark-ai-output-picked-up` / `reject-ai-output` on timeout) and multi-actor tools. Two write paths were not designed for retries:

1. `create_tasks_with_output` (`tools/ai_output.ts`) inserts N task rows, then one `ai_output` row. On output-insert failure it deletes the tasks but discards the delete's `{ error }` and always says "tasks rolled back". A sibling helper `insertTasksAtomically` in the same file already handles its own rollback correctly (captures the error, emits a WARNING naming orphaned ids) — so the truthful shape already exists; the second site just doesn't use it. The tool has no idempotency check, so a retried call double-inserts tasks under the same `reference_id`.
2. Six repository mutation methods stamp their timestamp column unconditionally: `markPickedUp` / `reject` (`supabase-ai-output-repository.ts`) and the four plain archive methods on task/person/thought repositories. Two claim-style siblings already exist and are correct: `archiveIfActive` and `archiveManyActive` filter on `.is("archived_at", null)`, so a re-run matches zero rows and is a no-op.

Constraint: migrations are append-only; this change touches no schema and adds no migration. Tests must exercise real repository code against the real Supabase stack (mock-boundary rule), so idempotency is proven end-to-end.

## Goals / Non-Goals

**Goals:**
- A retried repository mutation is a no-op: the original `picked_up_at` / `rejected_at` / `archived_at` is preserved.
- A failed compensating rollback in `create_tasks_with_output` is reported truthfully (WARNING + orphaned ids), never as "rolled back".
- A retried `create_tasks_with_output` does not create a second set of task rows for the same `file_path`.
- The two rollback-and-report sites share one helper (rule of three: this would be the second copy; consolidate now).

**Non-Goals:**
- Optimistic concurrency on read-modify-write metadata paths (Step 17 / TOOL-6).
- DB-level uniqueness / 23505-recovery for dedup (Steps 5 & 11).
- Changing `insertTasksAtomically`'s already-correct mid-loop rollback behavior.

## Decisions

**Decision 1 — Claim-style filters over a version column for the six mutations.**
Add `.eq("picked_up", false)` / `.eq("rejected", false)` / `.is("archived_at", null)` to the six methods, mirroring `archiveIfActive`. Rationale: the boolean/nullable-timestamp state column IS the idempotency token; a compare-and-set on it makes the second write match zero rows without a new column or migration. Alternative considered — an explicit `version` integer with optimistic concurrency — is heavier, needs a schema change, and is overkill for "don't re-stamp on retry" (that machinery belongs to Step 17's genuine read-modify-write clobber problem, not here).
Note: these methods return `RepoResult<void>` and callers do not currently branch on rows-affected, so adding the filter changes only the DB write, not the method contract. `markPickedUp` / `reject` will keep returning success on a re-run (the row is already in the target state) — the desired at-least-once semantics.

**Decision 2 — Extract a shared `rollbackTasks` helper.**
Factor the "delete the inserted task ids, check the delete's error, return either a WARNING-with-orphaned-ids note or a clean rolled-back note" logic out of `insertTasksAtomically` and reuse it at the `ai_output`-insert-failure site. Rationale: rule of three — this is the second occurrence, and the two copies drifting is exactly how the false "rolled back" message survived. One helper guarantees both sites report identically.

**Decision 3 — Idempotency via existing `findByReference` pre-check, refuse-with-clear-error.**
Before inserting, call `taskRepository.findByReference(file_path)`; if it returns any rows, return a clear error ("tasks for this file_path already exist — delete them first or use a different file_path") rather than silently inserting duplicates. Rationale: `reference_id = file_path` is already the dedup key the tool advertises for re-ingestion; reusing it for tool-call idempotency is consistent and needs no new key. Refusing (vs. returning the existing ids as success) is the safer default because the caller's second set of task inputs may differ from the first; a loud refusal surfaces the collision instead of masking it. This answers the three-questions checklist: *runs twice* → pre-check refuses the duplicate; *crashes halfway* → `insertTasksAtomically` already rolls back a partial task insert, and a crash after tasks + before `ai_output` leaves tasks discoverable by `findByReference` so the retry refuses rather than doubling; *interleaves* → two truly-simultaneous first-calls remain a narrow window (no DB unique constraint here), documented as accepted since `file_path` collisions from concurrent distinct calls are not a real usage pattern for this human-triggered tool.

## Risks / Trade-offs

- [Idempotency pre-check is not atomic with the insert — two concurrent first-time calls for the same `file_path` could both pass the check] → Accepted: `create_tasks_with_output` is an explicitly human-triggered, non-proactive tool; concurrent identical `file_path` calls are not a realistic path. A DB-level unique constraint on `reference_id` is out of scope (no migration in this step) and would over-constrain legitimate multi-task-per-file cases. Documented in the inline three-questions comment.
- [Claim-style filter could hide a genuine "row not found" from the caller] → The six methods already return `RepoResult<void>` and callers treat success as "the target state holds"; a re-run leaving the row in its already-target state is precisely the intended semantics, so no caller regresses.
- [A retried `markPickedUp` that races an un-pickup would no-op] → Un-pickup is not a supported operation; no such path exists.

## Migration Plan

No database migration. Pure code change to the edge function. Deploy is the standard function redeploy; rollback is reverting the code — the added SQL filters and the handler pre-check are backward-compatible with existing rows (they only narrow which rows a write touches).
