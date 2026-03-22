# Tasks

Actionable items, optionally linked to projects, with hierarchical subtask support.

## Data Model

- **Table:** `tasks`
- **Fields:** id (uuid), content (text), status (text — constrained to "open", "in_progress", "done", "deferred"), due_by (timestamptz, nullable), project_id (uuid, nullable — FK to projects, ON DELETE SET NULL), parent_id (uuid, nullable — self-referencing FK for subtasks, ON DELETE SET NULL), metadata (jsonb), archived_at (timestamptz, nullable), created_at, updated_at
- **Indexes:** btree on project_id, parent_id, status, due_by, archived_at
- **Trigger:** `updated_at` auto-updates on row change
- **Constraint:** status must be one of: open, in_progress, done, deferred

---

## Scenarios

### create_task

GIVEN the MCP server is running
WHEN a client calls `create_task` with `content`, optional `project_id`, `parent_id`, `due_by`, `status` (default "open")
THEN inserts a new task and returns "Created task (id: {uuid}): '{content}'"

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
