## ADDED Requirements

### Requirement: create_tasks_with_output atomic task creation

The `create_tasks_with_output` tool SHALL create its task rows atomically: if any task insert fails, the tool SHALL delete every task row it has already inserted in that call before returning an error, so a failed call leaves zero orphaned task rows. The tool SHALL report a rollback that itself fails, rather than reporting the call as successful.

#### Scenario: Mid-loop insert failure rolls back prior inserts

- **WHEN** `create_tasks_with_output` is called with multiple tasks and the insert of task N fails
- **THEN** the tool SHALL delete the rows for tasks 1..N-1 that were already inserted
- **AND** the tool SHALL return an error result naming the failing task
- **AND** no task rows for that call SHALL remain in the database

#### Scenario: Successful creation persists all tasks

- **WHEN** `create_tasks_with_output` is called with a valid set of tasks
- **THEN** all task rows SHALL be inserted
- **AND** the accompanying `ai_output` row SHALL be created
- **AND** the tool SHALL return the created task ids and output id

### Requirement: create_tasks_with_output parent_index validation

The `create_tasks_with_output` tool SHALL validate every task's `parent_index` before inserting any row. A `parent_index`, when present, MUST be an integer that is greater than or equal to 0 and strictly less than the task's own array index (i.e. it MUST reference an earlier task). If any `parent_index` violates this rule — a forward reference, a self reference, a negative value, an out-of-range value, or a non-integer — the tool SHALL reject the entire call with a clear error identifying the offending task, and SHALL create zero task rows and zero AI output. Because a valid `parent_index` is strictly less than the task's own index, subtask cycles are impossible and hierarchy is never silently dropped.

#### Scenario: Forward parent_index is rejected with no rows created

- **WHEN** `create_tasks_with_output` is called with a task whose `parent_index` points to a later task in the array
- **THEN** the tool SHALL return an error identifying the offending task and its `parent_index`
- **AND** no task rows SHALL be created
- **AND** no `ai_output` row SHALL be created

#### Scenario: Self-referential or out-of-range parent_index is rejected

- **WHEN** `create_tasks_with_output` is called with a task whose `parent_index` equals its own index, is negative, is greater than or equal to the number of tasks, or is not an integer
- **THEN** the tool SHALL return an error identifying the offending task
- **AND** no task rows SHALL be created

#### Scenario: Valid backward parent_index preserves hierarchy

- **WHEN** `create_tasks_with_output` is called with tasks whose `parent_index` values each reference an earlier task (e.g. parent at 0, child at 1 with `parent_index` 0, grandchild at 2 with `parent_index` 1)
- **THEN** all tasks SHALL be created
- **AND** each child task's `parent_id` SHALL point to the database id of the task at its `parent_index`
