# Tasks

Actionable items, optionally linked to projects, with hierarchical subtask support.

## Data Model

- **Table:** `tasks`
- **Fields:** id (uuid), content (text), status (text — constrained to "open", "in_progress", "done", "deferred"), due_by (timestamptz, nullable), project_id (uuid, nullable — FK to projects, ON DELETE SET NULL), parent_id (uuid, nullable — self-referencing FK for subtasks, ON DELETE SET NULL), reference_id (text, nullable — vault-relative path of source note for extractor-created tasks), metadata (jsonb), archived_at (timestamptz, nullable), created_at, updated_at
- **Indexes:** btree on project_id, parent_id, status, due_by, archived_at, reference_id
- **Trigger:** `updated_at` auto-updates on row change
- **Constraint:** status must be one of: open, in_progress, done, deferred

---

## Scenarios

### create_task

GIVEN the MCP server is running
WHEN a client calls `create_task` with `content`, optional `project_id`, `parent_id`, `due_by`, `status` (default "open")
THEN inserts a new task and returns "Created task (id: {uuid}): '{content}'"

---

### Auto-extracted task via TaskExtractor

GIVEN the TaskExtractor detects a checkbox in a note with a `referenceId`
WHEN the checkbox is processed
THEN a new task row SHALL be inserted with `content` from the checkbox text, `status` from checked state, and `reference_id` from the note's `referenceId`
AND the task SHALL be visible via `list_tasks`

---

### Explicit creation via MCP tool still works

GIVEN a client calls `create_task` with `content`, `project_id`, `status`
WHEN the task is created
THEN the task SHALL be created with all provided fields, with `reference_id: null`

---

### Reference_id enables reconciliation

GIVEN a note with a specific `referenceId` is re-ingested
WHEN the TaskExtractor processes it
THEN it SHALL query existing tasks WHERE `reference_id` matches the note's `referenceId` to reconcile against

---

### list_tasks

GIVEN the MCP server is running
WHEN a client calls `list_tasks` with optional `project_id`, `status`, `overdue_only` (default false), `include_archived` (default false), `limit` (default 20)
THEN the system:
  1. Queries tasks ordered by created_at descending
  2. Excludes archived unless include_archived=true
  3. Filters by project_id, status if provided
  4. If overdue_only=true: filters to tasks where due_by < now AND status != "done"
  5. Resolves project names for display
  6. Returns numbered list with status icon ([ ] open, [~] in_progress, [x] done), content, ID, status, project name, due date with OVERDUE flag

---

### update_task

GIVEN the MCP server is running
WHEN a client calls `update_task` with `id` and one or more of: `content`, `status`, `due_by` (nullable), `project_id` (nullable)
THEN updates the specified fields and returns "Task {id} updated: {field_names}"

GIVEN status is set to "done"
WHEN `update_task` is called
THEN additionally sets archived_at to the current timestamp (auto-archive on completion)

GIVEN no fields are provided
WHEN `update_task` is called
THEN returns "No fields to update."

---

### archive_task

GIVEN the MCP server is running
WHEN a client calls `archive_task` with `id`
THEN sets archived_at to the current timestamp and returns "Task {id} archived."
