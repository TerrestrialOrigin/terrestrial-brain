# Option 4 Integration — Delta Spec

AI-created tasks are written to the tasks table AND delivered as markdown to ai_output. On ingest, the TaskExtractor deduplicates against the pre-existing task rows.

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

### create_tasks_with_output: title and source_context

GIVEN the AI calls `create_tasks_with_output` with `title` and optional `source_context`
WHEN the tool executes
THEN the `ai_output` row SHALL have the provided `title`
AND `source_context` SHALL be stored (or null if not provided)

---

### Round-trip: no duplicate tasks on ingest

GIVEN the AI has called `create_tasks_with_output` creating N tasks at `file_path: "projects/CarChief/sprint-tasks.md"`
AND the tasks have `reference_id` = `"projects/CarChief/sprint-tasks.md"`
WHEN `ingest_note` is later called with the same content and `note_id: "projects/CarChief/sprint-tasks.md"`
THEN the TaskExtractor SHALL match all N checkboxes against the existing N tasks by content similarity
AND no new task rows SHALL be created
AND the thought references SHALL contain the pre-existing task IDs

---

### Round-trip: tasks with edits on ingest

GIVEN the AI has created tasks via `create_tasks_with_output` at a specific `file_path`
AND the user edits one checkbox text in the delivered file before re-ingest
WHEN `ingest_note` is called with the modified content
THEN the TaskExtractor SHALL match the edited checkbox if similarity >= 0.8
AND update the task's content to the new text
AND not create a duplicate

---

### Round-trip: user adds new checkbox after delivery

GIVEN the AI delivered tasks via `create_tasks_with_output`
AND the user adds a new `- [ ]` checkbox to the delivered file
WHEN `ingest_note` is called with the modified content
THEN the TaskExtractor SHALL create a new task for the added checkbox
AND keep the existing tasks matched

---

### Round-trip: user checks off a task

GIVEN the AI delivered tasks with open checkboxes (`- [ ]`)
AND the user checks off a task (`- [x]`)
WHEN `ingest_note` is called with the modified content
THEN the matching task's status SHALL be updated to "done"
