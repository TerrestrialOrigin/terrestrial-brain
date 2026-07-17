# AI Output

The reverse data path: AI-generated content delivered to the user's Obsidian vault. Replaces the previous `ai_notes` system with explicit file paths and picked-up tracking.

## Purpose

Define the reverse data path — AI-generated content delivered to the user's Obsidian vault — including its storage model, picked-up and rejection tracking, and the MCP tools that create it. Replaces the previous `ai_notes` system with explicit file paths and picked-up tracking.

## Data Model

- **Table:** `ai_output`
- **Fields:** id (uuid, PK, auto-generated), title (text, NOT NULL), content (text, NOT NULL), file_path (text, NOT NULL — full vault-relative path), source_context (text, nullable), created_at (timestamptz, NOT NULL, default now()), picked_up (boolean, NOT NULL, default false), picked_up_at (timestamptz, nullable)
- **Indexes:** partial btree on picked_up WHERE picked_up = false (`ai_output_picked_up_idx`)

---

## Requirements

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

The tool description SHALL explicitly state that:
1. The tool MUST only be called when the user has explicitly asked to create, write up, or save a document.
2. Every document delivered via this tool gets ingested into the knowledge base via `ingest_note`, so unnecessary calls create duplicate thoughts.
3. If the document should not be ingested as thoughts, the content MUST include a `#tbExclude` tag.
4. For task lists, callers SHOULD prefer `create_tasks_with_output`.

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

### Requirement: create_tasks_with_output MCP tool description policy

The `create_tasks_with_output` tool description SHALL explicitly state that the tool MUST only be called when the user has explicitly asked to create tasks or a task document. The description SHALL warn that the delivered markdown document gets ingested into the knowledge base via `ingest_note`, and that while task checkboxes use `reference_id` deduplication, prose content surrounding the task list can generate unwanted thoughts.

#### Scenario: Tool description communicates usage policy
- **WHEN** an AI caller reads the `create_tasks_with_output` tool description
- **THEN** the description SHALL include language stating the tool should only be called on explicit user request
- **AND** the description SHALL mention that delivered documents are ingested into the knowledge base

---

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

---

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


### Requirement: Pending AI-output reads are explicitly bounded

`get_pending_ai_output_metadata` SHALL accept a `max_rows` bound (default 200) and return at most that many rows via `LIMIT`, and the edge repository SHALL log a truncation warning when exactly `max_rows` rows are returned. `listPending` SHALL likewise be bounded. Truncation SHALL never rely on PostgREST's silent row cap.

#### Scenario: The metadata RPC respects max_rows
- **WHEN** more pending rows exist than `max_rows`
- **THEN** at most `max_rows` rows are returned and a possible-truncation warning is logged

#### Scenario: Pending list is bounded
- **WHEN** `listPending` runs against a large pending set
- **THEN** it fetches a bounded number of rows (not the whole table)
