## MODIFIED Requirements

### Requirement: Task creation paths
Tasks SHALL be creatable via two paths: (1) the existing `create_task` MCP tool with explicit content, project_id, parent_id, due_by, and status, and (2) auto-extraction by the TaskExtractor from note checkboxes. Auto-extracted tasks SHALL have `reference_id` set to the source note's vault-relative path.

#### Scenario: Auto-extracted task via TaskExtractor
- **WHEN** the TaskExtractor detects a `- [ ] Fix the navbar` checkbox in a note with `referenceId` of `projects/CarChief/sprint.md`
- **THEN** a new task row SHALL be inserted with `content: "Fix the navbar"`, `status: "open"`, `reference_id: "projects/CarChief/sprint.md"`
- **AND** the task SHALL be visible via `list_tasks`

#### Scenario: Explicit creation via MCP tool still works
- **WHEN** a client calls `create_task` with `content: "Review PR"`, `project_id: "..."`, `status: "open"`
- **THEN** the task SHALL be created with all provided fields as before, with `reference_id: null`

### Requirement: Tasks table reference_id column
The `tasks` table SHALL have a `reference_id` column (text, nullable, indexed) that stores the vault-relative path of the source note for extractor-created tasks.

#### Scenario: Reference_id enables reconciliation
- **WHEN** a note with `referenceId` of `projects/CarChief/sprint.md` is re-ingested
- **THEN** the TaskExtractor SHALL query existing tasks WHERE `reference_id = 'projects/CarChief/sprint.md'` to reconcile against
