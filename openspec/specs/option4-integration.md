# Option 4 Integration

When the AI creates tasks for the user, it writes structured data to the `tasks` table AND markdown to `ai_output`. On ingest, the TaskExtractor deduplicates against the pre-existing task rows using `reference_id` matching and content similarity.

## MCP Tool: create_tasks_with_output

Atomically creates structured task rows AND a markdown document with checkboxes delivered to the user's Obsidian vault. Tasks are tagged with `reference_id = file_path` so the TaskExtractor deduplicates on ingest.

### Input

- `title` (string, required) — human-readable title for the output document
- `file_path` (string, required) — target vault-relative path including filename
- `tasks` (array, required, min 1) — each element:
  - `content` (string, required) — task description
  - `project_id` (string, optional) — project UUID
  - `parent_index` (number, optional) — index of parent task in the array (0-based)
  - `status` (string, optional, default "open") — open, in_progress, done, deferred
  - `due_by` (string, optional) — ISO 8601 date
- `source_context` (string, optional) — what prompted this output

### Behavior

1. Validates tasks array is non-empty
2. Fetches project names for markdown heading generation
3. Inserts task rows sequentially with `reference_id = file_path`, resolving `parent_index → parent_id`
4. Generates markdown with `- [ ]`/`- [x]` checkboxes, project headings, subtask indentation
5. Creates `ai_output` row with the generated markdown
6. Returns task IDs and ai_output ID

---

## Scenarios

### create_tasks_with_output: basic task creation

GIVEN the AI calls `create_tasks_with_output` with a list of tasks and a `file_path`
WHEN the tool executes
THEN each task SHALL be inserted into the `tasks` table with `reference_id` set to the `file_path`
AND an `ai_output` row SHALL be created with markdown content containing `- [ ]` checkboxes for each task
AND the ai_output `file_path` SHALL match the provided `file_path`
AND the tool SHALL return the created task IDs and ai_output ID

---

### create_tasks_with_output: tasks with project association

GIVEN the AI calls `create_tasks_with_output` with tasks that have `project_id` set
WHEN the tool executes
THEN each task row SHALL have the specified `project_id`
AND the generated markdown SHALL group tasks under project name headings

---

### create_tasks_with_output: subtask hierarchy

GIVEN the AI calls `create_tasks_with_output` with tasks where some have `parent_index` referencing another task in the list
WHEN the tool executes
THEN child tasks SHALL have `parent_id` set to the DB ID of their parent task
AND the generated markdown SHALL indent child checkboxes under their parent

---

### create_tasks_with_output: checked tasks

GIVEN the AI calls `create_tasks_with_output` with a task that has `status: "done"`
WHEN the tool executes
THEN the task row SHALL have `status: "done"` and `archived_at` set
AND the generated markdown SHALL use `- [x]` for that task

---

### create_tasks_with_output: empty tasks list

GIVEN the AI calls `create_tasks_with_output` with an empty `tasks` array
WHEN the tool executes
THEN the tool SHALL return an error "At least one task is required"
AND no rows SHALL be inserted into `tasks` or `ai_output`

---

### Round-trip: no duplicate tasks on ingest

GIVEN the AI has called `create_tasks_with_output` creating N tasks at a specific `file_path`
AND the tasks have `reference_id` = the `file_path`
WHEN `ingest_note` is later called with the same content and `note_id` = the same `file_path`
THEN the TaskExtractor SHALL match all N checkboxes against the existing N tasks by content similarity
AND no new task rows SHALL be created
AND the thought references SHALL contain the pre-existing task IDs

---

### Round-trip: user edits after delivery

GIVEN the AI delivered tasks via `create_tasks_with_output`
AND the user edits checkbox text (>80% similarity preserved)
WHEN `ingest_note` is called with the modified content
THEN the TaskExtractor SHALL match and update the task content

---

### Round-trip: user adds new checkbox

GIVEN the AI delivered tasks via `create_tasks_with_output`
AND the user adds a new `- [ ]` checkbox
WHEN `ingest_note` is called with the modified content
THEN the TaskExtractor SHALL create a new task for the added checkbox while keeping existing tasks matched

---

### Round-trip: user checks off a task

GIVEN the AI delivered open checkboxes (`- [ ]`)
AND the user checks one off (`- [x]`)
WHEN `ingest_note` is called with the modified content
THEN the matching task's status SHALL be updated to "done"
