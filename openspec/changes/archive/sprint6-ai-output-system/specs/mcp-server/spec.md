## MODIFIED Requirements

### Requirement: Tool Modules

The MCP server SHALL organize tools into modules, each exporting a `register(server, supabase)` function:

| Module | Tools |
|--------|-------|
| `tools/thoughts.ts` | search_thoughts, list_thoughts, thought_stats, capture_thought, ingest_note |
| `tools/projects.ts` | create_project, list_projects, get_project, update_project, archive_project |
| `tools/tasks.ts` | create_task, list_tasks, update_task, archive_task |
| `tools/ai_output.ts` | create_ai_output, get_pending_ai_output, mark_ai_output_picked_up |

#### Scenario: AI output tools registered
- **WHEN** the MCP server starts
- **THEN** it SHALL register `create_ai_output`, `get_pending_ai_output`, and `mark_ai_output_picked_up` from `tools/ai_output.ts`

#### Scenario: Old ai_notes tools removed
- **WHEN** a client calls `create_ai_note`, `get_unsynced_ai_notes`, or `mark_notes_synced`
- **THEN** the server SHALL return a tool-not-found error (these tools no longer exist)

---

## REMOVED Requirements

### Requirement: ai_notes tools
**Reason:** Replaced by `ai_output` tools with explicit `file_path`, no frontmatter injection, and `picked_up` boolean tracking.
**Migration:** Use `create_ai_output` instead of `create_ai_note`, `get_pending_ai_output` instead of `get_unsynced_ai_notes`, `mark_ai_output_picked_up` instead of `mark_notes_synced`.
