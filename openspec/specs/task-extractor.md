# TaskExtractor

Detects tasks from note checkboxes, associates with projects, reconciles on re-ingest, and manages subtask hierarchy.

## Detection Signals (priority order)

1. **Section heading** — checkbox's `sectionHeading` matching a known project name (case-insensitive)
2. **File path project** — from ProjectExtractor's result (all tasks in `/projects/{name}/` default to that project)
3. **AI content inference** — batch LLM call for remaining unassigned tasks

---

## Scenarios

### Unchecked checkbox creates open task

GIVEN a parsed note contains `- [ ] Buy groceries`
THEN the TaskExtractor SHALL insert a task row with `content: "Buy groceries"`, `status: "open"`, and `reference_id` set to the note's `referenceId`

---

### Checked checkbox creates done task

GIVEN a parsed note contains `- [x] Fix login bug`
THEN the TaskExtractor SHALL insert a task row with `content: "Fix login bug"`, `status: "done"`, and `archived_at` set to the current timestamp

---

### Note with no checkboxes

GIVEN a parsed note has an empty `checkboxes` array
THEN the TaskExtractor SHALL return an `ExtractionResult` with an empty `ids` array

---

### Indented checkbox becomes subtask

GIVEN a parsed note contains a parent checkbox followed by an indented child checkbox
THEN the child task's `parent_id` SHALL be set to the DB ID of the parent task

---

### Deeply nested subtasks

GIVEN a parsed note has three levels of indented checkboxes
THEN each child SHALL reference its immediate parent via `parent_id`

---

### Child without valid parent

GIVEN a checkbox has `parentIndex` but the parent task was not created (error case)
THEN the child task SHALL have `parent_id: null`

---

### Task under project heading

GIVEN a checkbox's `sectionHeading` is "CarChief" and "CarChief" is a known project
THEN the task SHALL be associated with the CarChief project (`project_id` set)

---

### Task in project folder with no section heading match

GIVEN a note is at `projects/CarChief/tasks.md` and a checkbox has no matching section heading
THEN the task SHALL default to the CarChief project (from pipeline's project references)

---

### AI-inferred project association

GIVEN a checkbox text mentions "CarChief tickets" but has no heading or path match
AND "CarChief" is a known project
THEN the AI content inference SHALL associate the task with CarChief

---

### No project match

GIVEN a checkbox has no matching section heading, no file path project, and the AI finds no match
THEN the task SHALL have `project_id: null`

---

### Re-ingest with unchanged checkbox

GIVEN a note is re-ingested and a checkbox has identical text to an existing task with the same `reference_id`
THEN the existing task SHALL be kept (not duplicated), and its ID SHALL be in the result

---

### Re-ingest with checked checkbox (was unchecked)

GIVEN a previously unchecked checkbox is now checked (`- [x]`)
THEN the matching task's status SHALL be updated to `"done"` and `archived_at` set

---

### Re-ingest with unchecked checkbox (was checked)

GIVEN a previously checked checkbox is now unchecked (`- [ ]`)
THEN the matching task's status SHALL be updated to `"open"` and `archived_at` cleared to null

---

### Re-ingest with new checkbox added

GIVEN a note is re-ingested with a new checkbox that doesn't match any existing task
THEN a new task row SHALL be created for the new checkbox

---

### Re-ingest with checkbox removed

GIVEN a note is re-ingested and an existing task has no matching checkbox
THEN the existing task SHALL NOT be deleted (it persists in the DB)

---

### Re-ingest with edited checkbox text

GIVEN a checkbox text has been slightly edited (>80% similarity to existing task)
THEN the existing task SHALL be matched and its content updated to the new text

---

### TaskExtractor referenceKey

GIVEN the TaskExtractor produces a result
THEN `result.referenceKey` SHALL equal `"tasks"`

---

### New tasks enrich context

GIVEN the TaskExtractor creates 3 new task rows
THEN `context.newlyCreatedTasks` SHALL contain 3 entries with the new tasks' IDs and content
