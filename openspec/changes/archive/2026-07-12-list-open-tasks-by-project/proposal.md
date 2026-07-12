## Why

There is no single MCP call that answers "what is on my plate, organized by project?". Today `list_tasks` returns a flat list filtered to one project and one status (default limit 20), and `get_project_summary` covers a single project at a time. To review every outstanding task an AI (or the human, through the AI) must page through projects one by one and mentally stitch the results together — and tasks with no project assigned are easy to lose entirely. A read-only, whole-brain, grouped-by-project view closes that gap in one call and directly supports the periodic project/task review workflow.

## What Changes

- Add a new read-only MCP tool `list_open_tasks_by_project` that returns **all** incomplete (status ≠ `done`), unarchived tasks across the whole brain, grouped by project.
- Tasks with no `project_id` are collected into a dedicated **"(No project)"** group so they are never dropped, rendered last.
- Projects are rendered as grouped sections ordered alphabetically by project name; tasks within each group are ordered overdue-first, then by due date ascending (undated last), then by creation date.
- The query is **bounded**: an explicit `limit` cap on the total number of tasks fetched, with any truncation surfaced in the response body and logged — never a silent unbounded fetch-all.
- Optional `include_deferred` flag (default `true`) so `deferred` tasks can be excluded from the "incomplete" set when the caller only wants actionable work.
- Add one bounded query method to the `TaskRepository` seam to back the tool; grouping and project-name resolution happen in the tool handler.
- No changes to existing tools; this is purely additive.

## Capabilities

### New Capabilities
- `open-tasks-by-project`: A read-only MCP tool that returns every incomplete, unarchived task grouped by project (with a distinct no-project group), with deterministic project and task ordering, an explicit bounded cap, and telemetry (record count + returned ids) via the standard logging wrapper.

### Modified Capabilities
<!-- No spec-level requirement changes to existing capabilities. The tasks and task-repository specs are impacted at the implementation level only (a new tool + a new repository method), documented under Impact. -->

## Non-goals

- **Sub-project nesting.** Each project is rendered as its own flat group; the tool does not build a parent→child tree or roll child-project tasks up under a parent. Parent context may appear in the group header, but hierarchical nesting is out of scope for this change.
- **Mutation.** This tool never changes task status, archives, or reconciles anything; closing/updating still goes through `update_task`.
- **Pagination/cursoring.** The bounded `limit` with explicit truncation reporting is sufficient for the review use case; a paged cursor API is not part of this change.
- **Filtering by person/assignee, due-date window, or free-text search.** Those remain the province of `list_tasks`.

## Impact

- New tool registered in `supabase/functions/terrestrial-brain-mcp/tools/tasks.ts` (or `queries.ts`), following the existing `withMcpLogging` + Zod `inputSchema` + formatted-markdown-text-body convention used by `list_tasks`.
- New bounded method on the `TaskRepository` interface (`repositories/task-repository.ts`) and its Supabase implementation (`repositories/supabase-task-repository.ts`).
- Telemetry: handler supplies real `recordsReturned` (total tasks emitted) and `returnedIds` to the logging layer, consistent with the records-returned/returned-ids work already in `logger.ts`.
- MCP tool-count/registration and any tool-list snapshot tests updated for the new tool.
- Affected spec files: `openspec/specs/tasks.md`, `openspec/specs/task-repository/spec.md` (implementation-level impact, referenced from the new `open-tasks-by-project` spec).
