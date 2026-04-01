## Context

The MCP server exposes task management tools (`create_task`, `list_tasks`, `update_task`, `archive_task`) but has no way to fetch specific tasks by ID. Other entity types (`get_person`, `get_project`) already support direct ID lookup. The AI frequently knows specific task IDs from prior tool calls or `get_project_summary` output and needs to fetch their current state.

## Goals / Non-Goals

**Goals:**
- Allow fetching one or more tasks by UUID in a single call
- Return full metadata: resolved project name, assigned person name, overdue detection, parent task info
- Follow the established patterns in `tasks.ts` for formatting and error handling

**Non-Goals:**
- No database schema changes or new indexes (PK lookup is already O(1))
- No changes to existing tools
- No batch update/delete capability — this is read-only

## Decisions

### 1. Array input, array output (not single-ID)

Accept an array of UUIDs and return all matching tasks. This avoids N+1 round trips when the caller needs multiple tasks (e.g. checking status of several tasks from a project summary).

**Alternative considered:** Single-ID `get_task` matching `get_person`/`get_project` pattern. Rejected because the user specifically requested batch lookup and it's strictly more useful — a single ID is just an array of length 1.

### 2. Use Supabase `.in()` for batch fetch

Query `tasks` with `.in("id", ids)` to fetch all matching rows in one query, then batch-resolve project and person names with additional `.in()` queries. This matches the pattern already used in `list_tasks`.

### 3. Reuse `list_tasks` formatting

Output each task in the same format as `list_tasks` (status icon, content, ID, project name, person name, due date with overdue flag). This keeps the AI's context consistent regardless of which tool fetched the task.

### 4. Include archived tasks by default

Since the caller is fetching by explicit ID, they know what they want. Filtering out archived tasks would be surprising — if you ask for a task by ID, you should get it regardless of archive status.

### 5. Report missing IDs

If any requested IDs are not found in the database, include a note listing the missing IDs at the end of the response. This makes debugging easier without failing the entire request.

### Test Strategy

- **Unit tests:** Not applicable — no standalone logic to unit test (the tool is a thin DB query + formatting layer)
- **Integration tests:** SQL-level test in `supabase/tests/tasks.test.sql` verifying the query pattern works against real schema
- **E2E tests:** MCP tool call via HTTP to the running edge function, verifying correct response format

## Risks / Trade-offs

- **[Large ID arrays]** A caller could pass hundreds of IDs, creating a large `IN (...)` clause. Mitigation: cap the array at 50 IDs with a clear error message. This is generous for any realistic use case.
- **[Missing IDs silently ignored]** If an ID doesn't exist, the response simply omits it. Mitigation: append a "Not found" note listing missing IDs so the caller knows.
