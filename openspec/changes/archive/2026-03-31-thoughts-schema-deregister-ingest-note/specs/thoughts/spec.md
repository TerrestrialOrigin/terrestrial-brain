## MODIFIED Requirements

### Requirement: Thought data model

The core knowledge unit in Terrestrial Brain. Thoughts are self-contained, 1-3 sentence statements extracted from notes or captured directly via MCP.

- **Table:** `thoughts`
- **Fields:** id (uuid), content (text), embedding (vector 1536), metadata (jsonb), created_at, updated_at, reference_id (text, nullable), note_snapshot_id (uuid, nullable — FK to note_snapshots.id, ON DELETE SET NULL), **reliability** (text, nullable — `'reliable'` or `'less reliable'`), **author** (text, nullable — model identifier string e.g. `'gpt-4o-mini'`)
- **Indexes:** HNSW on embedding (cosine), GIN on metadata, btree on created_at (desc), btree on reference_id, btree on note_snapshot_id
- **Trigger:** `updated_at` auto-updates on row change

#### Scenario: Existing thoughts backfilled with reliability and author
- **WHEN** the migration runs on a database with existing thoughts
- **THEN** all existing rows SHALL have `reliability = 'less reliable'` and `author = 'gpt-4o-mini'`

#### Scenario: New columns are nullable
- **WHEN** a thought is inserted without specifying `reliability` or `author`
- **THEN** the row SHALL be created with `reliability = NULL` and `author = NULL`

### Requirement: ingest_note sets reliability and author on thoughts

All thoughts created or updated by the `ingest_note` pipeline SHALL have `reliability = 'less reliable'` and `author = 'gpt-4o-mini'` (or the current extraction model constant).

#### Scenario: Fresh ingest sets reliability and author
- **WHEN** `ingest_note` performs a fresh ingest (no prior thoughts for this note_id)
- **THEN** each inserted thought SHALL have `reliability = 'less reliable'` and `author = 'gpt-4o-mini'`

#### Scenario: Reconciliation update sets reliability and author
- **WHEN** `ingest_note` reconciles existing thoughts and updates a thought
- **THEN** the updated thought SHALL have `reliability = 'less reliable'` and `author = 'gpt-4o-mini'`

#### Scenario: Reconciliation add sets reliability and author
- **WHEN** `ingest_note` reconciles existing thoughts and adds a new thought
- **THEN** the added thought SHALL have `reliability = 'less reliable'` and `author = 'gpt-4o-mini'`

### Requirement: ingest_note is not an MCP tool

The `ingest_note` function SHALL NOT be registered as an MCP tool. It SHALL be accessible only via a direct HTTP endpoint.

#### Scenario: AI caller attempts ingest_note via MCP
- **WHEN** an AI client sends a JSON-RPC `tools/call` request with `name: "ingest_note"`
- **THEN** the MCP server SHALL return a "tool not found" error

#### Scenario: ingest_note logic remains functional
- **WHEN** the `/ingest-note` HTTP endpoint is called with valid content
- **THEN** the system SHALL split the note into thoughts, generate embeddings, extract metadata, and store thoughts exactly as before

## ADDED Requirements

### Requirement: Metadata schema includes reliability and author

The metadata schema for thoughts is extended with top-level `reliability` and `author` columns (not inside the jsonb `metadata` field).

#### Scenario: Thought row includes reliability column
- **WHEN** a thought row is queried from the database
- **THEN** the row SHALL include a `reliability` column of type text (nullable)

#### Scenario: Thought row includes author column
- **WHEN** a thought row is queried from the database
- **THEN** the row SHALL include an `author` column of type text (nullable)
