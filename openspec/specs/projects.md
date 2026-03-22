# Projects

Hierarchical project organization for grouping thoughts and tasks.

## Data Model

- **Table:** `projects`
- **Fields:** id (uuid), name (text), type (text, nullable — e.g. "client", "personal", "research", "internal"), parent_id (uuid, nullable — self-referencing FK, ON DELETE SET NULL), description (text, nullable), metadata (jsonb), archived_at (timestamptz, nullable — null=active), created_at, updated_at
- **Indexes:** btree on parent_id, btree on archived_at
- **Trigger:** `updated_at` auto-updates on row change

---

## Scenarios

### create_project

GIVEN the MCP server is running
WHEN a client calls `create_project` with `name`, optional `type`, optional `parent_id`, optional `description`
THEN inserts a new project row and returns "Created project '{name}' (id: {uuid})"

---

### Auto-created project via extractor

GIVEN a note's `referenceId` matches the pattern `projects/{name}/...`
AND no project with that name exists in the database
WHEN the ProjectExtractor processes the note
THEN a new project row SHALL be inserted with `name` from the folder, `type: null`, `description: null`
AND the project SHALL be visible via `list_projects` and `get_project`

---

### Explicit creation via MCP tool still works

GIVEN a client calls `create_project` with `name: "MyProject"`, `type: "client"`, `description: "A new client project"`
WHEN the project is created
THEN the project SHALL be created with all provided fields as before

---

### list_projects

GIVEN the MCP server is running
WHEN a client calls `list_projects` with optional `include_archived` (default false), `parent_id`, `type`
THEN the system:
  1. Queries projects ordered by created_at descending
  2. Excludes archived unless include_archived=true
  3. Filters by parent_id and/or type if provided
  4. Resolves parent names for display
  5. Counts active children for each project
  6. Returns numbered list with name, ID, type, parent, children count, created date, archived date

---

### get_project

GIVEN the MCP server is running
WHEN a client calls `get_project` with `id`
THEN returns full project details: name, ID, type, description, parent name, active children list, open task count (status in open/in_progress), created/updated/archived dates

GIVEN the project does not exist
WHEN `get_project` is called
THEN returns "Project not found" with isError: true

---

### update_project

GIVEN the MCP server is running
WHEN a client calls `update_project` with `id` and one or more of: `name`, `type`, `parent_id` (nullable), `description`
THEN updates the specified fields and returns "Project {id} updated: {field_names}"

GIVEN no fields are provided
WHEN `update_project` is called
THEN returns "No fields to update."

---

### archive_project

GIVEN the MCP server is running
WHEN a client calls `archive_project` with `id`
THEN the system:
  1. Verifies the project exists
  2. Recursively collects all descendant project IDs (breadth-first traversal of active children)
  3. Sets archived_at on all collected projects (the target + all descendants)
  4. Archives all open/in_progress tasks belonging to any of these projects
  5. Returns "Archived project '{name}'" with counts of child projects and tasks archived

GIVEN the project does not exist
WHEN `archive_project` is called
THEN returns "Project not found" with isError: true
