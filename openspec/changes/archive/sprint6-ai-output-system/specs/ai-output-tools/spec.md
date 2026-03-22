## ADDED Requirements

### Requirement: create_ai_output MCP tool

The MCP server SHALL expose a `create_ai_output` tool that inserts a row into the `ai_output` table. The tool accepts `title` (string, required), `content` (string, required — full markdown body as-is, no frontmatter injection), `file_path` (string, required — vault-relative path including filename), and `source_context` (string, optional — what prompted this output). The row SHALL be inserted with `picked_up = false`.

#### Scenario: Create AI output with all fields
- **WHEN** a client calls `create_ai_output` with `title: "Sprint Plan"`, `content: "# Sprint Plan\n\n- [ ] Task 1"`, `file_path: "projects/TerrestrialCore/SprintPlan.md"`, `source_context: "User asked for a sprint plan"`
- **THEN** the system SHALL insert a row into `ai_output` with those values and `picked_up = false`
- **AND** return a confirmation: `Created AI output "Sprint Plan" (id: {uuid})\nWill appear at: projects/TerrestrialCore/SprintPlan.md`

#### Scenario: Create AI output without source_context
- **WHEN** a client calls `create_ai_output` with `title`, `content`, and `file_path` but no `source_context`
- **THEN** the system SHALL insert the row with `source_context = null`
- **AND** return the same confirmation format

#### Scenario: Content stored as-is (no frontmatter injection)
- **WHEN** a client calls `create_ai_output` with any `content` value
- **THEN** the system SHALL store the content exactly as provided — no YAML frontmatter, UUID, timestamp, or `terrestrialBrainExclude` tag SHALL be prepended

#### Scenario: Missing required field
- **WHEN** a client calls `create_ai_output` without `title`, `content`, or `file_path`
- **THEN** the system SHALL return a validation error

---

### Requirement: get_pending_ai_output MCP tool

The MCP server SHALL expose a `get_pending_ai_output` tool that returns all `ai_output` rows where `picked_up = false`, as a JSON array. The tool accepts no parameters.

#### Scenario: Pending output exists
- **WHEN** a client calls `get_pending_ai_output` and unpicked rows exist
- **THEN** the system SHALL return a JSON array of objects, each containing `id`, `title`, `content`, `file_path`, `created_at`
- **AND** the results SHALL be ordered by `created_at` ascending

#### Scenario: No pending output
- **WHEN** a client calls `get_pending_ai_output` and no unpicked rows exist
- **THEN** the system SHALL return an empty JSON array `[]`

#### Scenario: Picked-up output excluded
- **WHEN** a client calls `get_pending_ai_output` and some rows have `picked_up = true`
- **THEN** those rows SHALL NOT appear in the result

---

### Requirement: mark_ai_output_picked_up MCP tool

The MCP server SHALL expose a `mark_ai_output_picked_up` tool that sets `picked_up = true` and `picked_up_at = now()` for the specified rows. The tool accepts `ids` (array of UUID strings, required).

#### Scenario: Mark single output as picked up
- **WHEN** a client calls `mark_ai_output_picked_up` with `ids: ["uuid1"]`
- **THEN** the system SHALL set `picked_up = true` and `picked_up_at` to the current timestamp for that row
- **AND** return `Marked 1 output(s) as picked up.`

#### Scenario: Mark multiple outputs as picked up
- **WHEN** a client calls `mark_ai_output_picked_up` with `ids: ["uuid1", "uuid2", "uuid3"]`
- **THEN** the system SHALL update all three rows
- **AND** return `Marked 3 output(s) as picked up.`

#### Scenario: Picked-up output no longer appears in pending
- **WHEN** `mark_ai_output_picked_up` is called for an output ID
- **AND** a subsequent call to `get_pending_ai_output` is made
- **THEN** the marked output SHALL NOT appear in the result
