## MODIFIED Requirements

### Requirement: Project creation paths
Projects SHALL be creatable via two paths: (1) the existing `create_project` MCP tool with explicit name, type, parent_id, and description, and (2) auto-creation by the ProjectExtractor when a `projects/{name}/` folder is detected in a note's `referenceId` with no matching DB row. Auto-created projects SHALL have `type: null` and `description: null`.

#### Scenario: Auto-created project via extractor
- **WHEN** the ProjectExtractor detects a `projects/NewProject/` path with no matching project in the DB
- **THEN** a new project row SHALL be inserted with `name: "NewProject"`, `type: null`, `description: null`
- **AND** the project SHALL be visible via `list_projects` and `get_project`

#### Scenario: Explicit creation via MCP tool still works
- **WHEN** a client calls `create_project` with `name: "MyProject"`, `type: "client"`, `description: "A new client project"`
- **THEN** the project SHALL be created with all provided fields as before
