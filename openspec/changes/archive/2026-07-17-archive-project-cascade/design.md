## Context

`archive_project` inlined a BFS that dropped the error channel of `listActiveChildIds`/`findOpenIdsByProjects`, archived projects before tasks, and had no cycle guard. `update_project` set `parent_id` unchecked. The archive-first ordering is the dangerous one: a crash after projects are archived but before tasks leaves descendants archived so a re-run's `listActiveChildIds` finds no active children and can never archive the orphaned open tasks.

## Goals / Non-Goals

**Goals:**
- A failed read never renders as a completed archive.
- A crash mid-cascade leaves a recoverable state.
- Cyclic hierarchies terminate; cycles cannot be created.

**Non-Goals:** a single recursive-CTE RPC (the tasks-first order already gives recoverability).

## Decisions

- **Extract `archiveProjectCascade(projectRepository, taskRepository, rootId)` returning a discriminated `ArchiveCascadeOutcome`.** Pure w.r.t. the seams, so it is unit-testable with fake repos (the finding's requested test shape). The handler becomes thin: fetch name, run the cascade, map `ok:false` → errorResult.
- **Order: collect ids → archive tasks → archive projects.** Recovery reasoning: after a crash between the task-archive and project-archive, the projects are still active, so a re-run rediscovers the subtree (children active) and finishes. The reverse order (the old code) is unrecoverable.
- **Visited set in the BFS.** Bounds the traversal even if the data already contains a cycle.
- **`wouldCreateProjectCycle` walks the proposed parent's ancestor chain.** If it reaches `id`, the edge closes a loop. A visited set bounds the walk against pre-existing cycles. Wired into `update_project` only for a non-null string `parent_id` (null = remove parent, never a cycle).

### User error scenarios

- Transient DB error mid-archive → clean abort, nothing archived, retryable.
- LLM/user proposes a cyclic parent → rejected with a clear message, hierarchy unchanged.

### Security analysis

No new external surface. The cycle guard prevents a self-inflicted DoS (unbounded traversal) on the archive path. Error messages are repository messages. No ThreatModel change.

### Test Strategy

- Unit (RED-first): `archiveProjectCascade` with fake repos — failed child lookup and failed task lookup each abort with NO archive writes; tasks archived before projects (call-order assertion); cyclic graph terminates. `wouldCreateProjectCycle` — self-parent, descendant-as-parent, and unrelated cases. RED captured by an intermediate that swallowed errors and archived projects-first.
- Integration: `update_project` rejects a cycle-creating `parent_id` (via `callToolRaw`), and the project's `parent_id` stays unchanged.

## Risks / Trade-offs

- **Trade-off:** two sequential archive writes (not one transaction) still have a crash window, but the tasks-first order makes that window recoverable — the accepted, simpler alternative to an RPC.
