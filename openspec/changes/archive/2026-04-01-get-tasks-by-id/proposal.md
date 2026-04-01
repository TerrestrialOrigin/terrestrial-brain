## Why

There is no way to retrieve specific tasks by ID. The existing `list_tasks` tool only supports filter-based queries (by project, status, overdue). When the AI or user already knows the task IDs they need (e.g. from a previous `create_task` call, from `get_project_summary` output, or from a stored reference), they must either re-list and scan or have no way to fetch task details. A `get_tasks` tool that accepts an array of UUIDs fills this gap, matching the pattern already established by `get_person` and `get_project`.

## What Changes

- Add a new `get_tasks` MCP tool in `supabase/functions/terrestrial-brain-mcp/tools/tasks.ts`
- Accepts an array of task UUIDs, returns matching tasks with full metadata (project name, assigned person name, overdue detection, subtask parent info)
- Returns tasks in the same rich format as `list_tasks` (status icons, resolved names, overdue flags)

## Non-goals

- No changes to existing task tools (`create_task`, `list_tasks`, `update_task`, `archive_task`)
- No database schema changes
- No new indexes (the primary key lookup is already indexed)

## Capabilities

### New Capabilities
- `get-tasks-by-id`: Retrieve one or more tasks by their UUIDs with full resolved metadata

### Modified Capabilities
- `tasks`: Adding a new `get_tasks` scenario to the existing tasks spec (`openspec/specs/tasks.md`)

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/tools/tasks.ts` — new tool registration
- **Spec:** `openspec/specs/tasks.md` — new scenario added
- **APIs/deps:** No new dependencies; uses existing Supabase client and Zod
