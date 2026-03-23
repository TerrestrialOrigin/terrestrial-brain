## MODIFIED Requirements

### Requirement: create_ai_output MCP tool

The MCP server SHALL expose a `create_ai_output` tool that validates the file path and inserts a row into the `ai_output` table. The tool accepts `title` (string, required), `content` (string, required — full markdown body as-is, no frontmatter injection), `file_path` (string, required — vault-relative path including filename), and `source_context` (string, optional — what prompted this output). The tool SHALL validate `file_path` before insertion. If validation fails, the tool SHALL return an error with `isError: true` and a descriptive message. If validation passes, the row SHALL be inserted with `picked_up = false`.

#### Scenario: Create AI output with all fields
- **WHEN** a client calls `create_ai_output` with `title: "Sprint Plan"`, `content: "# Sprint Plan\n\n- [ ] Task 1"`, `file_path: "projects/TerrestrialCore/SprintPlan.md"`, `source_context: "User asked for a sprint plan"`
- **THEN** the system SHALL insert a row into `ai_output` with those values and `picked_up = false`
- **AND** return a confirmation: `Created AI output "Sprint Plan" (id: {uuid})\nWill appear at: projects/TerrestrialCore/SprintPlan.md`

#### Scenario: Create AI output without source_context
- **WHEN** a client calls `create_ai_output` with `title`, `content`, and `file_path` but no `source_context`
- **THEN** the system SHALL insert the row with `source_context = null`

#### Scenario: Content stored as-is (no frontmatter injection)
- **WHEN** a client calls `create_ai_output` with any `content` value
- **THEN** the system SHALL store the content exactly as provided — no YAML frontmatter, UUID, timestamp, or `terrestrialBrainExclude` tag SHALL be prepended

#### Scenario: Reject invalid file path
- **WHEN** a client calls `create_ai_output` with an invalid `file_path` (per filepath-validation rules)
- **THEN** the system SHALL NOT insert any row into `ai_output`
- **AND** return an error response with `isError: true` and a descriptive message explaining why the path is invalid

#### Scenario: AI output can target any vault folder
- **WHEN** a client calls `create_ai_output` with `file_path: "deeply/nested/folder/structure/document.md"`
- **THEN** the system SHALL accept the path and insert the row
- **AND** when the plugin delivers this output, it SHALL create all parent directories as needed
