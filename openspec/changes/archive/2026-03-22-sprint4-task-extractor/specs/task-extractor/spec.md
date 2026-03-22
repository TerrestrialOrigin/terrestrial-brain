## ADDED Requirements

### Requirement: TaskExtractor converts checkboxes to task rows
The TaskExtractor SHALL process `ParsedNote.checkboxes` and create or update task rows in the `tasks` table. Each checkbox produces one task with `content` from the checkbox text, `status` from the checked state, and `reference_id` from the note's `referenceId`.

#### Scenario: Unchecked checkbox creates open task
- **WHEN** a parsed note contains `- [ ] Buy groceries`
- **THEN** the TaskExtractor SHALL insert a task row with `content: "Buy groceries"`, `status: "open"`, and `reference_id` set to the note's `referenceId`

#### Scenario: Checked checkbox creates done task
- **WHEN** a parsed note contains `- [x] Fix login bug`
- **THEN** the TaskExtractor SHALL insert a task row with `content: "Fix login bug"`, `status: "done"`, and `archived_at` set to the current timestamp

#### Scenario: Note with no checkboxes
- **WHEN** a parsed note has an empty `checkboxes` array
- **THEN** the TaskExtractor SHALL return an `ExtractionResult` with an empty `ids` array

### Requirement: Subtask hierarchy from indentation
The TaskExtractor SHALL use `ParsedCheckbox.parentIndex` to establish `parent_id` relationships between tasks. Parent tasks are processed before children (document order).

#### Scenario: Indented checkbox becomes subtask
- **WHEN** a parsed note contains:
  ```
  - [ ] Parent task
    - [ ] Child task
  ```
- **THEN** the child task's `parent_id` SHALL be set to the DB ID of the parent task

#### Scenario: Deeply nested subtasks
- **WHEN** a parsed note has three levels of indented checkboxes
- **THEN** each child SHALL reference its immediate parent via `parent_id`

#### Scenario: Child without valid parent
- **WHEN** a checkbox has `parentIndex` but the parent task was not created (error case)
- **THEN** the child task SHALL have `parent_id: null`

### Requirement: Project association via priority chain
The TaskExtractor SHALL associate tasks with projects using this priority order:
1. Section heading matching a known project name (case-insensitive)
2. File path project (from ProjectExtractor's result, all tasks in a `/projects/{name}/` note default to that project)
3. AI content inference (batch LLM call for remaining unassigned tasks)

#### Scenario: Task under project heading
- **WHEN** a checkbox's `sectionHeading` is "CarChief" and "CarChief" is a known project
- **THEN** the task SHALL be associated with the CarChief project (`project_id` set)

#### Scenario: Task in project folder with no section heading match
- **WHEN** a note is at `projects/CarChief/tasks.md` and a checkbox has no matching section heading
- **THEN** the task SHALL default to the CarChief project (from pipeline's project references)

#### Scenario: AI-inferred project association
- **WHEN** a checkbox text mentions "CarChief tickets" but has no heading or path match
- **AND** "CarChief" is a known project
- **THEN** the AI content inference SHALL associate the task with CarChief

#### Scenario: No project match
- **WHEN** a checkbox has no matching section heading, no file path project, and the AI finds no match
- **THEN** the task SHALL have `project_id: null`

### Requirement: Reconciliation on re-ingest
On re-ingest of the same note (same `reference_id`), the TaskExtractor SHALL match checkboxes against existing tasks rather than creating duplicates.

#### Scenario: Re-ingest with unchanged checkbox
- **WHEN** a note is re-ingested and a checkbox has identical text to an existing task with the same `reference_id`
- **THEN** the existing task SHALL be kept (not duplicated), and its ID SHALL be in the result

#### Scenario: Re-ingest with checked checkbox (was unchecked)
- **WHEN** a previously unchecked checkbox is now checked (`- [x]`)
- **THEN** the matching task's status SHALL be updated to `"done"` and `archived_at` set

#### Scenario: Re-ingest with unchecked checkbox (was checked)
- **WHEN** a previously checked checkbox is now unchecked (`- [ ]`)
- **THEN** the matching task's status SHALL be updated to `"open"` and `archived_at` cleared to null

#### Scenario: Re-ingest with new checkbox added
- **WHEN** a note is re-ingested with a new checkbox that doesn't match any existing task
- **THEN** a new task row SHALL be created for the new checkbox

#### Scenario: Re-ingest with checkbox removed
- **WHEN** a note is re-ingested and an existing task has no matching checkbox
- **THEN** the existing task SHALL NOT be deleted (it persists in the DB)

#### Scenario: Re-ingest with edited checkbox text
- **WHEN** a checkbox text has been slightly edited (>80% similarity to existing task)
- **THEN** the existing task SHALL be matched and its content updated to the new text

### Requirement: TaskExtractor referenceKey
The TaskExtractor SHALL use `"tasks"` as its `referenceKey`.

#### Scenario: Reference key value
- **WHEN** the TaskExtractor produces a result
- **THEN** `result.referenceKey` SHALL equal `"tasks"`

### Requirement: Context enrichment
The TaskExtractor SHALL add newly created tasks to `context.newlyCreatedTasks`.

#### Scenario: New tasks enrich context
- **WHEN** the TaskExtractor creates 3 new task rows
- **THEN** `context.newlyCreatedTasks` SHALL contain 3 entries with the new tasks' IDs and content
