# AI Output

The reverse data path: AI-generated content delivered to the user's Obsidian vault. Replaces the previous `ai_notes` system with explicit file paths and picked-up tracking.

## Data Model

- **Table:** `ai_output`
- **Fields:** id (uuid, PK, auto-generated), title (text, NOT NULL), content (text, NOT NULL), file_path (text, NOT NULL — full vault-relative path), source_context (text, nullable), created_at (timestamptz, NOT NULL, default now()), picked_up (boolean, NOT NULL, default false), picked_up_at (timestamptz, nullable)
- **Indexes:** partial btree on picked_up WHERE picked_up = false (`ai_output_picked_up_idx`)

---

## Scenarios

### Requirement: AI output storage

The system SHALL store AI-generated output destined for the user's Obsidian vault in the `ai_output` table with the following columns:
- `id` (uuid, PK, auto-generated)
- `title` (text, NOT NULL)
- `content` (text, NOT NULL)
- `file_path` (text, NOT NULL) — full vault-relative path including filename
- `source_context` (text, nullable) — what prompted this output
- `created_at` (timestamptz, NOT NULL, default `now()`)
- `picked_up` (boolean, NOT NULL, default `false`)
- `picked_up_at` (timestamptz, nullable)

#### Scenario: Insert new AI output
- **WHEN** a row is inserted into `ai_output` with `title`, `content`, and `file_path`
- **THEN** the row SHALL be created with `picked_up` defaulting to `false`, `picked_up_at` defaulting to NULL, and `created_at` defaulting to now

#### Scenario: Title is required
- **WHEN** a row is inserted with `title` set to NULL
- **THEN** the database SHALL reject the insert with a NOT NULL violation

#### Scenario: File path is required
- **WHEN** a row is inserted with `file_path` set to NULL
- **THEN** the database SHALL reject the insert with a NOT NULL violation

---

### Requirement: AI output picked-up tracking

The system SHALL track whether each AI output has been picked up by the Obsidian plugin. A partial index on `picked_up` WHERE `picked_up = false` SHALL exist for efficient polling.

#### Scenario: Poll for unpicked output
- **WHEN** a query selects rows where `picked_up = false`
- **THEN** the query plan SHALL use the `ai_output_picked_up_idx` partial index

#### Scenario: Mark output as picked up
- **WHEN** a row's `picked_up` is updated from `false` to `true` and `picked_up_at` is set
- **THEN** the row SHALL no longer appear in queries filtered by `picked_up = false`

---

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

---

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

---

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

---

### Requirement: mark_ai_output_picked_up MCP tool

The MCP server SHALL expose a `mark_ai_output_picked_up` tool that sets `picked_up = true` and `picked_up_at = now()` for the specified rows. The tool accepts `ids` (array of UUID strings, required).

#### Scenario: Mark single output as picked up
- **WHEN** a client calls `mark_ai_output_picked_up` with `ids: ["uuid1"]`
- **THEN** the system SHALL set `picked_up = true` and `picked_up_at` to the current timestamp for that row
- **AND** return `Marked 1 output(s) as picked up.`

#### Scenario: Picked-up output no longer appears in pending
- **WHEN** `mark_ai_output_picked_up` is called for an output ID
- **AND** a subsequent call to `get_pending_ai_output` is made
- **THEN** the marked output SHALL NOT appear in the result

---

### Requirement: reject_ai_output MCP tool

The MCP server SHALL expose a `reject_ai_output` tool that marks specified AI output rows as rejected. The tool accepts `ids` (array of UUID strings, required). For each specified row, it SHALL set `rejected = true` and `rejected_at = now()`.

#### Scenario: Reject single output
- **WHEN** a client calls `reject_ai_output` with `ids: ["uuid1"]`
- **THEN** the system SHALL set `rejected = true` and `rejected_at` to the current timestamp for that row
- **AND** return `Rejected 1 output(s).`

#### Scenario: Rejected output excluded from pending
- **WHEN** `reject_ai_output` is called for an output ID
- **AND** a subsequent call to `get_pending_ai_output` is made
- **THEN** the rejected output SHALL NOT appear in the result
