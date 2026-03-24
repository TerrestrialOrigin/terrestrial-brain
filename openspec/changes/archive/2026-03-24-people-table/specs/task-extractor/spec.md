## ADDED Requirements

### Requirement: Task schema includes assigned_to
The tasks table SHALL have an optional `assigned_to` column (uuid, nullable) referencing `people(id)` with ON DELETE SET NULL.

#### Scenario: Task created without assignment
- **WHEN** a task is created via `create_task` without `assigned_to`
- **THEN** the task's `assigned_to` SHALL be null

#### Scenario: Task assigned to a person
- **WHEN** `create_task` is called with a valid `assigned_to` person UUID
- **THEN** the task SHALL be created with that person's UUID in `assigned_to`

#### Scenario: Task updated with assignment
- **WHEN** `update_task` is called with `assigned_to` set to a valid person UUID
- **THEN** the task's `assigned_to` SHALL be updated to that UUID

#### Scenario: Task assignment cleared
- **WHEN** `update_task` is called with `assigned_to` set to null
- **THEN** the task's `assigned_to` SHALL be set to null

#### Scenario: Assigned person deleted
- **WHEN** a person referenced by `assigned_to` is deleted from the people table
- **THEN** the task's `assigned_to` SHALL be set to null (ON DELETE SET NULL)

#### Scenario: List tasks shows assigned person name
- **WHEN** `list_tasks` returns tasks that have `assigned_to` set
- **THEN** the output SHALL include the assigned person's name for each task

#### Scenario: Project summary shows assigned person name
- **WHEN** `get_project_summary` returns tasks that have `assigned_to` set
- **THEN** the task list in the output SHALL include the assigned person's name
