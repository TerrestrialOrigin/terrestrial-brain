## ADDED Requirements

### Requirement: get_tasks retrieves tasks by UUID array
The MCP server SHALL expose a `get_tasks` tool that accepts an array of task UUIDs and returns the matching tasks with full resolved metadata.

#### Scenario: Single task lookup
- **WHEN** a client calls `get_tasks` with `ids` containing one valid task UUID
- **THEN** the system SHALL return that task with: status icon, content, ID, status, project name (if linked), assigned person name (if assigned), due date with OVERDUE flag (if applicable), archived date (if archived)

#### Scenario: Multiple task lookup
- **WHEN** a client calls `get_tasks` with `ids` containing multiple valid task UUIDs
- **THEN** the system SHALL return all matching tasks, each formatted identically to the single-task case

#### Scenario: Some IDs not found
- **WHEN** a client calls `get_tasks` with `ids` where some UUIDs do not exist in the database
- **THEN** the system SHALL return the tasks that were found AND append a note listing the IDs that were not found

#### Scenario: No IDs found
- **WHEN** a client calls `get_tasks` with `ids` where none of the UUIDs exist in the database
- **THEN** the system SHALL return a "No tasks found" message listing the missing IDs

#### Scenario: Empty array
- **WHEN** a client calls `get_tasks` with an empty `ids` array
- **THEN** the system SHALL return an error message indicating that at least one ID is required

#### Scenario: Too many IDs
- **WHEN** a client calls `get_tasks` with `ids` containing more than 50 UUIDs
- **THEN** the system SHALL return an error message indicating the maximum is 50 IDs per request

#### Scenario: Archived tasks are included
- **WHEN** a client calls `get_tasks` with an ID of an archived task
- **THEN** the system SHALL return that task with its archived date shown, without filtering it out

### Requirement: get_tasks resolves related entity names
The `get_tasks` tool SHALL resolve foreign key references to human-readable names for display.

#### Scenario: Task with project linkage
- **WHEN** a returned task has a `project_id`
- **THEN** the output SHALL include the project's name (resolved from the projects table)

#### Scenario: Task with person assignment
- **WHEN** a returned task has an `assigned_to` value
- **THEN** the output SHALL include the person's name (resolved from the people table)

#### Scenario: Task with parent task
- **WHEN** a returned task has a `parent_id`
- **THEN** the output SHALL include the parent task's content (resolved from the tasks table)
