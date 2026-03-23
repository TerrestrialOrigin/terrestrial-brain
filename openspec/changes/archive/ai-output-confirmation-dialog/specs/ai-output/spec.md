## ADDED Requirements

### Requirement: AI output rejection tracking

The `ai_output` table SHALL include columns for tracking rejection:
- `rejected` (boolean, NOT NULL, default `false`)
- `rejected_at` (timestamptz, nullable)

A partial index SHALL exist on `(picked_up, rejected) WHERE picked_up = false AND rejected = false` for efficient polling of pending outputs.

#### Scenario: New row defaults to not rejected
- **WHEN** a row is inserted into `ai_output` without specifying `rejected`
- **THEN** the row SHALL have `rejected = false` and `rejected_at = NULL`

#### Scenario: Reject an output
- **WHEN** a row's `rejected` is updated from `false` to `true` and `rejected_at` is set
- **THEN** the row SHALL no longer appear in queries filtered by `picked_up = false AND rejected = false`

### Requirement: reject_ai_output MCP tool

The MCP server SHALL expose a `reject_ai_output` tool that marks specified AI output rows as rejected. The tool accepts `ids` (array of UUID strings, required). For each specified row, it SHALL set `rejected = true` and `rejected_at = now()`.

#### Scenario: Reject single output
- **WHEN** a client calls `reject_ai_output` with `ids: ["uuid1"]`
- **THEN** the system SHALL set `rejected = true` and `rejected_at` to the current timestamp for that row
- **AND** return `Rejected 1 output(s).`

#### Scenario: Reject multiple outputs
- **WHEN** a client calls `reject_ai_output` with `ids: ["uuid1", "uuid2", "uuid3"]`
- **THEN** the system SHALL set `rejected = true` and `rejected_at` to the current timestamp for all three rows
- **AND** return `Rejected 3 output(s).`

#### Scenario: Rejected output excluded from pending
- **WHEN** `reject_ai_output` is called for an output ID
- **AND** a subsequent call to `get_pending_ai_output` is made
- **THEN** the rejected output SHALL NOT appear in the result

## MODIFIED Requirements

### Requirement: get_pending_ai_output MCP tool

The MCP server SHALL expose a `get_pending_ai_output` tool that returns all `ai_output` rows where `picked_up = false` AND `rejected = false`, as a JSON array. The tool accepts no parameters.

#### Scenario: Pending output exists
- **WHEN** a client calls `get_pending_ai_output` and unpicked, non-rejected rows exist
- **THEN** the system SHALL return a JSON array of objects, each containing `id`, `title`, `content`, `file_path`, `created_at`
- **AND** the results SHALL be ordered by `created_at` ascending

#### Scenario: No pending output
- **WHEN** a client calls `get_pending_ai_output` and no unpicked, non-rejected rows exist
- **THEN** the system SHALL return an empty JSON array `[]`

#### Scenario: Rejected output excluded
- **WHEN** a client calls `get_pending_ai_output`
- **AND** some rows have `rejected = true`
- **THEN** those rows SHALL NOT appear in the result
