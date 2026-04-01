# Thoughts

The core knowledge unit in Terrestrial Brain. Thoughts are self-contained, 1-3 sentence statements extracted from notes or captured directly via MCP.

## Data Model

- **Table:** `thoughts`
- **Fields:** id (uuid), content (text), embedding (vector 1536), metadata (jsonb), created_at, updated_at, reference_id (text, nullable — vault-relative path for note-sourced thoughts), note_snapshot_id (uuid, nullable — FK to note_snapshots.id, ON DELETE SET NULL), reliability (text, nullable — `'reliable'` or `'less reliable'`), author (text, nullable — model identifier string e.g. `'gpt-4o-mini'`)
- **Indexes:** HNSW on embedding (cosine), GIN on metadata, btree on created_at (desc), btree on reference_id, btree on note_snapshot_id
- **Trigger:** `updated_at` auto-updates on row change

### Metadata Schema (jsonb)

Extracted by GPT-4o-mini via `extractMetadata()`:

- `type`: one of "observation", "task", "idea", "reference", "person_note"
- `topics`: array of 1-3 short topic tags (always at least one)
- `people`: array of people mentioned (may be empty)
- `action_items`: array of implied to-dos (may be empty)
- `dates_mentioned`: array of dates in YYYY-MM-DD format (may be empty)
- `source`: "obsidian" (from plugin ingest) or "mcp" (from direct capture)
- `note_title`: title of the source note (null for direct captures)
- `references.project_id`: UUID of a detected project (legacy format, optional)
- `references.projects`: array of project UUIDs (new format, optional)
- `references.tasks`: array of task UUIDs (new format, optional)
- `updated_at`: ISO timestamp (set only on reconciliation updates)

---

## Scenarios

### capture_thought

GIVEN the MCP server is running
WHEN a client calls `capture_thought` with a `content` string
THEN the system:
  1. Runs structural parser on content to produce a `ParsedNote`
  2. Runs the extractor pipeline (ProjectExtractor, TaskExtractor) to produce `references`
  3. Generates a 1536-dim embedding via OpenRouter (text-embedding-3-small)
  4. Extracts metadata via OpenRouter (gpt-4o-mini)
  5. Inserts a row into `thoughts` with source="mcp", reference_id=null, note_snapshot_id=null, metadata.references from step 2
  6. Returns a confirmation string

#### Scenario: capture_thought with pipeline
- **WHEN** `capture_thought` is called with content mentioning a known project
- **THEN** the thought SHALL have `metadata.references.projects` containing that project's ID

GIVEN embedding or metadata extraction fails
WHEN `capture_thought` is called
THEN the tool returns an error message with `isError: true`

---

### ingest_note — fresh (no prior thoughts for this note_id)

GIVEN the `/ingest-note` HTTP endpoint is running
AND the note has no existing thoughts (no rows with matching reference_id)
WHEN a client calls `POST /ingest-note` with `content`, optional `title`, optional `note_id`
THEN the system:
  1. If `note_id` is provided, upserts `note_snapshots` with `reference_id = note_id`, returning `note_snapshot_id`
  2. Runs structural parser on content to produce a `ParsedNote`
  3. Runs the extractor pipeline (ProjectExtractor, TaskExtractor) to produce `references = { projects: [...], tasks: [...] }`
  4. Calls GPT-4o-mini to split the note into discrete, self-contained thoughts
     - Each thought is 1-3 sentences, preserving specificity (names, dates, decisions)
     - Decisions prefixed with "Decision:", tasks with "TODO:"
     - Project detection is NOT done in this prompt (handled by extractors in step 3)
  5. For each extracted thought, in parallel:
     a. Generates embedding
     b. Extracts metadata
     c. Inserts into `thoughts` with reference_id=note_id, note_snapshot_id from step 1, source="obsidian", metadata.references from step 3, reliability="less reliable", author="gpt-4o-mini"
  6. Returns summary including thought count, task count, and project count

#### Scenario: Fresh ingest with pipeline integration
- **WHEN** `ingest_note` is called with content containing checkboxes and project references
- **THEN** the system SHALL create task rows, detect projects, store a snapshot, and tag all thoughts with the pipeline references

GIVEN the note content is empty or yields no thoughts
WHEN `ingest_note` is called
THEN returns "No thoughts extracted — note may be empty."

---

### ingest_note — reconciliation (existing thoughts for this note_id)

GIVEN the `/ingest-note` HTTP endpoint is running
AND the note already has thoughts in the database (rows with matching reference_id)
WHEN a client calls `POST /ingest-note` with `content`, `title`, and `note_id`
THEN the system:
  1. If `note_id` is provided, upserts `note_snapshots` with `reference_id = note_id`, returning `note_snapshot_id`
  2. Runs structural parser and extractor pipeline to produce `references`
  3. Fetches all existing thoughts for this reference_id, ordered by created_at ascending
  4. Calls GPT-4o-mini with both the existing thoughts (tagged with [ID:uuid]) and the new note content
  5. The LLM returns a reconciliation plan: keep, update, add, delete
     - Project detection is NOT done in this prompt (handled by extractors in step 2)
  6. Executes the plan in parallel:
     - Updated thoughts get new content, embedding, metadata, note_snapshot_id, metadata.references from pipeline, reliability="less reliable", author="gpt-4o-mini"
     - Added thoughts get inserted with reference_id, note_snapshot_id, source="obsidian", metadata.references, reliability="less reliable", author="gpt-4o-mini"
     - Deleted thoughts are removed from the database
  7. Returns summary including thought count, task count, and project count

#### Scenario: Reconciliation with pipeline integration
- **WHEN** `ingest_note` reconciles a note containing checkboxes
- **THEN** task rows SHALL be created/updated by the pipeline and all thoughts SHALL have the pipeline references

GIVEN reconciliation LLM response fails to parse
WHEN `ingest_note` is called with existing thoughts
THEN falls back to `freshIngest()` (treats it as a new note), still with pipeline references

---

### search_thoughts

GIVEN the MCP server is running
WHEN a client calls `search_thoughts` with a `query` string, optional `limit` (default 10), optional `threshold` (default 0.5)
THEN the system:
  1. Generates an embedding for the query
  2. Calls `match_thoughts` RPC: cosine similarity search on the `thoughts` table
  3. Returns results sorted by similarity descending, each showing:
     - Similarity percentage, capture date, type, topics, people, action items, and content

GIVEN no thoughts exceed the similarity threshold
WHEN `search_thoughts` is called
THEN returns "No thoughts found matching '{query}'."

---

### list_thoughts

GIVEN the MCP server is running
WHEN a client calls `list_thoughts` with optional filters: `limit` (default 10), `type`, `topic`, `person`, `days`
THEN the system:
  1. Queries `thoughts` ordered by created_at descending
  2. Applies filters via jsonb `contains` (type, topic, person) and date range (days)
  3. Returns numbered list with date, type, topics, and content

---

### thought_stats

GIVEN the MCP server is running
WHEN a client calls `thought_stats` (no parameters)
THEN the system:
  1. Gets total thought count
  2. Fetches all metadata and created_at values
  3. Aggregates: type counts, top 10 topics, top 10 people mentioned
  4. Returns formatted summary with total count, date range, type breakdown, top topics, and people

---

### Thought data model — note_snapshot_id

The `note_snapshot_id` column links a thought to the full source note it was extracted from. It SHALL be:
- Nullable — NULL for thoughts from direct capture, chat, or if the snapshot was purged
- A foreign key referencing `note_snapshots(id)` with `ON DELETE SET NULL`
- Indexed via btree (`thoughts_note_snapshot_id_idx`)

#### Scenario: Thought with note snapshot reference
- **WHEN** a thought is inserted with `note_snapshot_id` set to a valid `note_snapshots.id`
- **THEN** the FK constraint SHALL be satisfied and the row SHALL be created

#### Scenario: Thought without note snapshot reference
- **WHEN** a thought is inserted with `note_snapshot_id` set to NULL
- **THEN** the row SHALL be created (nullable FK allows NULL)

#### Scenario: Invalid note snapshot reference
- **WHEN** a thought is inserted with `note_snapshot_id` set to a UUID that does not exist in `note_snapshots`
- **THEN** the database SHALL reject the insert with a FK violation

#### Scenario: Cascade behavior on snapshot deletion
- **WHEN** a `note_snapshots` row is deleted
- **THEN** all `thoughts` rows referencing that snapshot SHALL have their `note_snapshot_id` set to NULL (not deleted)

#### Scenario: Backwards-compatible metadata references
- **WHEN** existing thoughts have `metadata.references.project_id` (single string format)
- **THEN** application code SHALL read both old format (`{ project_id: "uuid" }`) and new format (`{ projects: ["uuid"], tasks: ["uuid"] }`)
