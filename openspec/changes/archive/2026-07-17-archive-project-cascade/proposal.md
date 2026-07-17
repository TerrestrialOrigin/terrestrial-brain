## Why

`archive_project` had three defects in one multi-step mutation (TOOL-2): (1) it destructured only `data` from `listActiveChildIds` and `findOpenIdsByProjects`, so a failed traversal/lookup silently terminated discovery yet still reported "Archived project" — a partial failure rendered as complete success; (2) it archived projects FIRST and tasks SECOND, so a crash between the two leaves descendants archived-but-tasks-orphaned with no way for a re-run to rediscover them; and (3) the traversal had no visited-set or depth bound, and `update_project` set `parent_id` with no cycle check, so a parent cycle spun the loop until the wall-clock kill.

## What Changes

- Extract the cascade into `archiveProjectCascade`: checks every read's error channel and aborts (errorResult) before any write; traverses with a visited set so a cycle terminates; archives **tasks first, projects last** so a crash leaves a recoverable (still-active) state.
- Add `wouldCreateProjectCycle` and wire it into `update_project`: a `parent_id` that would close a cycle is rejected before the write.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `projects`: Archiving a project cascades error-checked and in a crash-recoverable order, and updating a project's parent cannot create a cycle.

## Impact

- `tools/projects.ts` (`archiveProjectCascade`, `wouldCreateProjectCycle`, `archive_project` + `update_project` handlers)
- Tests: `tests/unit/archive-project-cascade.test.ts`, `tests/integration/projects.test.ts`
- No schema or dependency changes.

## Non-goals

- Moving the cascade into a single Postgres recursive-CTE RPC (an alternative the finding mentions) — the tasks-first ordering already makes a crash recoverable without it.
