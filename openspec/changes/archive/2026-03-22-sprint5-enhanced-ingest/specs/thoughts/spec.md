## MODIFIED Requirements

### Requirement: ingest_note — fresh (no prior thoughts for this note_id)

GIVEN the MCP server is running
AND the note has no existing thoughts (no rows with matching reference_id)
WHEN a client calls `ingest_note` with `content`, optional `title`, optional `note_id`
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
     c. Inserts into `thoughts` with reference_id=note_id, note_snapshot_id from step 1, source="obsidian", metadata.references from step 3
  6. Returns summary including thought count, task count, and project count

#### Scenario: Fresh ingest with pipeline integration
- **WHEN** `ingest_note` is called with content containing checkboxes and project references
- **THEN** the system SHALL create task rows, detect projects, store a snapshot, and tag all thoughts with the pipeline references

GIVEN the note content is empty or yields no thoughts
WHEN `ingest_note` is called
THEN returns "No thoughts extracted — note may be empty."

---

### Requirement: ingest_note — reconciliation (existing thoughts for this note_id)

GIVEN the MCP server is running
AND the note already has thoughts in the database (rows with matching reference_id)
WHEN a client calls `ingest_note` with `content`, `title`, and `note_id`
THEN the system:
  1. If `note_id` is provided, upserts `note_snapshots` with `reference_id = note_id`, returning `note_snapshot_id`
  2. Runs structural parser and extractor pipeline to produce `references`
  3. Fetches all existing thoughts for this reference_id, ordered by created_at ascending
  4. Calls GPT-4o-mini with both the existing thoughts (tagged with [ID:uuid]) and the new note content
  5. The LLM returns a reconciliation plan: keep, update, add, delete
     - Project detection is NOT done in this prompt (handled by extractors in step 2)
  6. Executes the plan in parallel:
     - Updated thoughts get new content, embedding, metadata, note_snapshot_id, and metadata.references from pipeline
     - Added thoughts get inserted with reference_id, note_snapshot_id, source="obsidian", and metadata.references
     - Deleted thoughts are removed from the database
  7. Returns summary including thought count, task count, and project count

#### Scenario: Reconciliation with pipeline integration
- **WHEN** `ingest_note` reconciles a note containing checkboxes
- **THEN** task rows SHALL be created/updated by the pipeline and all thoughts SHALL have the pipeline references

GIVEN reconciliation LLM response fails to parse
WHEN `ingest_note` is called with existing thoughts
THEN falls back to `freshIngest()` (treats it as a new note), still with pipeline references

---

### Requirement: capture_thought

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
