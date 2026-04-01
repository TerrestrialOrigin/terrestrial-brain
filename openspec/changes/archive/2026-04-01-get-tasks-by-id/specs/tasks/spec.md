## ADDED Requirements

### Requirement: get_tasks
The MCP server SHALL expose a `get_tasks` tool that accepts an array of task UUIDs and returns matching tasks with resolved metadata (project name, assigned person name, overdue detection).

#### Scenario: get_tasks returns tasks by ID
- **WHEN** a client calls `get_tasks` with `ids` containing valid task UUIDs
- **THEN** the system queries tasks matching the provided IDs, resolves project names and assigned person names, and returns a formatted list with status icon, content, ID, status, project name, person name, due date with OVERDUE flag, and archived date if applicable
