## 1. MCP Tool — create_tasks_with_output

- [x] 1.1 Add `create_tasks_with_output` tool to `tools/ai_output.ts` with Zod schema: `tasks` array (content, project_id?, parent_index?, status?, due_by?), `file_path` (required), `title` (required), `source_context` (optional)
- [x] 1.2 Implement task row insertion with `reference_id` = `file_path`, handling parent_index → parent_id resolution
- [x] 1.3 Implement markdown generation: `- [ ]`/`- [x]` checkboxes, project heading grouping, indentation for subtasks
- [x] 1.4 Implement ai_output row insertion with generated markdown content
- [x] 1.5 Return response with task IDs and ai_output ID

## 2. Testing & Verification

- [x] 2.1 Add plugin unit tests for `create_tasks_with_output`: basic creation, project grouping, subtask hierarchy, checked tasks, empty tasks error
- [x] 2.2 Add round-trip integration test: create tasks + ai_output → ingest same content → verify no duplicate tasks, thoughts reference pre-existing IDs
- [x] 2.3 Run full test suite across all packages: 0 failures, 0 skips
