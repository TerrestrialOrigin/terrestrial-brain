## MODIFIED Requirements

### Requirement: create_tasks_with_output atomic task creation

The `create_tasks_with_output` tool SHALL create its task rows atomically: if any task insert fails, the tool SHALL delete every task row it has already inserted in that call before returning an error, so a failed call leaves zero orphaned task rows. If the accompanying `ai_output` insert fails after the task rows were inserted, the tool SHALL likewise delete those task rows before returning an error. In every rollback path, the tool SHALL check the outcome of the compensating delete: if the delete itself fails, the tool SHALL report a WARNING that names the possibly-orphaned task ids, rather than reporting that the rows were rolled back or that the call succeeded. Both rollback sites SHALL report through the same shared reporting logic so their messages cannot drift.

#### Scenario: Mid-loop insert failure rolls back prior inserts

- **WHEN** `create_tasks_with_output` is called with multiple tasks and the insert of task N fails
- **THEN** the tool SHALL delete the rows for tasks 1..N-1 that were already inserted
- **AND** the tool SHALL return an error result naming the failing task
- **AND** no task rows for that call SHALL remain in the database

#### Scenario: ai_output insert failure rolls back the inserted tasks

- **WHEN** `create_tasks_with_output` inserts all task rows successfully but the subsequent `ai_output` insert fails
- **THEN** the tool SHALL delete every task row it inserted in that call
- **AND** the tool SHALL return an error result
- **AND** no task rows for that call SHALL remain in the database

#### Scenario: Failed rollback is reported as a warning, not as success

- **WHEN** a rollback delete in `create_tasks_with_output` itself fails
- **THEN** the tool SHALL return an error whose message warns that task rows may be orphaned and names their ids
- **AND** the message SHALL NOT claim the rows were rolled back

#### Scenario: Successful creation persists all tasks

- **WHEN** `create_tasks_with_output` is called with a valid set of tasks
- **THEN** all task rows SHALL be inserted
- **AND** the accompanying `ai_output` row SHALL be created
- **AND** the tool SHALL return the created task ids and output id

## ADDED Requirements

### Requirement: create_tasks_with_output is idempotent per file_path

The `create_tasks_with_output` tool SHALL be safe to retry. Before inserting task rows, the tool SHALL check whether tasks already exist for the target `file_path` (via the tasks' `reference_id`). If such tasks already exist, the tool SHALL NOT insert a second set of task rows; it SHALL return a clear error indicating that tasks for that `file_path` already exist. This prevents an at-least-once client retry — one that re-issues the call after the tasks were inserted but before the response was received — from creating duplicate task rows.

#### Scenario: Retried call does not double-insert tasks

- **GIVEN** `create_tasks_with_output` was already called successfully for a given `file_path`
- **WHEN** the tool is called again with the same `file_path`
- **THEN** the tool SHALL NOT create a second set of task rows
- **AND** the tool SHALL return a clear error stating tasks for that `file_path` already exist
- **AND** the total number of task rows with that `reference_id` SHALL equal the count from the first call

#### Scenario: First call for a fresh file_path succeeds

- **WHEN** `create_tasks_with_output` is called with a `file_path` that has no existing tasks
- **THEN** the tool SHALL insert the task rows and create the `ai_output` row as normal
