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

The `capture_thought` MCP tool SHALL accept a required `content` string, and optional `author` string, `project_ids` UUID array, `document_ids` UUID array, and `builds_on` UUID array.

When invoked, the tool SHALL:
  1. Run the structural parser on `content` to produce a `ParsedNote`.
  2. Run the extractor pipeline (ProjectExtractor, PeopleExtractor, TaskExtractor) to produce `references`.
  3. If `project_ids` is provided, merge those UUIDs into `references.projects` as a union with pipeline-detected projects (no duplicates).
  4. If `document_ids` is provided, merge those UUIDs into `references.documents` as a union (no duplicates).
  5. Generate a 1536-dim embedding via OpenRouter (text-embedding-3-small).
  6. Extract metadata via OpenRouter (gpt-4o-mini).
  7. Insert a row into `thoughts` with `source="mcp"`, `reference_id=null`, `note_snapshot_id=null`, `metadata.references` from steps 2-4, `reliability="reliable"`, and `author` set to the provided value or null.
  8. If `builds_on` is provided and non-empty, call the `increment_usefulness(uuid[])` RPC with the provided UUIDs as a best-effort side effect AFTER the insert succeeds. A failure of this side effect MUST NOT roll back the insert, MUST be logged server-side, and SHALL be reported in the confirmation string.
  9. Return a confirmation string. When `builds_on` was provided and non-empty, the confirmation SHALL include the count of prior thoughts credited (e.g. "credited N prior thought(s) as sources.").

#### Scenario: capture_thought with pipeline
- **WHEN** `capture_thought` is called with content mentioning a known project
- **THEN** the thought SHALL have `metadata.references.projects` containing that project's ID

#### Scenario: capture_thought sets reliability to reliable
- **WHEN** `capture_thought` is called with any content
- **THEN** the inserted thought SHALL have `reliability = 'reliable'`

#### Scenario: capture_thought stores author when provided
- **WHEN** `capture_thought` is called with `author = 'claude-sonnet-4-6'`
- **THEN** the inserted thought SHALL have `author = 'claude-sonnet-4-6'`

#### Scenario: capture_thought without author
- **WHEN** `capture_thought` is called without an `author` parameter
- **THEN** the inserted thought SHALL have `author = null`

#### Scenario: capture_thought merges explicit project_ids with pipeline
- **WHEN** `capture_thought` is called with `project_ids = ['uuid-A']` and the content also mentions a project detected as `uuid-B`
- **THEN** the inserted thought SHALL have `metadata.references.projects` containing both `uuid-A` and `uuid-B`

#### Scenario: capture_thought with project_ids only (no pipeline match)
- **WHEN** `capture_thought` is called with `project_ids = ['uuid-A']` and the content does not mention any known project
- **THEN** the inserted thought SHALL have `metadata.references.projects` containing `uuid-A`

#### Scenario: capture_thought with builds_on credits prior thoughts
- **WHEN** `capture_thought` is called with `builds_on = ['uuid-P', 'uuid-Q']` where both UUIDs reference existing thoughts
- **THEN** the new thought SHALL be inserted successfully
- **AND** the `usefulness_score` of the thought identified by `uuid-P` SHALL be incremented by 1
- **AND** the `usefulness_score` of the thought identified by `uuid-Q` SHALL be incremented by 1
- **AND** the confirmation string SHALL report that 2 prior thought(s) were credited

#### Scenario: capture_thought without builds_on does not touch other thoughts
- **WHEN** `capture_thought` is called without a `builds_on` parameter
- **THEN** no other thought's `usefulness_score` SHALL change as a result of this call

#### Scenario: capture_thought with builds_on containing unknown UUID
- **WHEN** `capture_thought` is called with `builds_on = ['uuid-existing', 'uuid-does-not-exist']`
- **THEN** the new thought SHALL be inserted successfully
- **AND** only the existing thought's `usefulness_score` SHALL be incremented
- **AND** the confirmation string SHALL report that 1 prior thought was credited

#### Scenario: capture_thought with empty builds_on array
- **WHEN** `capture_thought` is called with `builds_on = []`
- **THEN** the new thought SHALL be inserted successfully
- **AND** no other thought's `usefulness_score` SHALL change
- **AND** the confirmation string SHALL NOT include a credited-sources note

When embedding or metadata extraction fails, the tool SHALL return an error message with `isError: true`.

#### Scenario: Embedding or metadata extraction fails
- **WHEN** the embedding or metadata extraction step throws
- **THEN** the tool SHALL return a response with `isError: true` and an error message

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

The `search_thoughts` MCP tool SHALL accept a required `query` string, an optional `limit` (default 10), an optional `threshold` (default 0.5), an optional `author` filter, and an optional `reliability` filter.

When invoked, the tool SHALL:
  1. Generate an embedding for the query.
  2. Call the `match_thoughts` RPC to perform a cosine similarity search over the `thoughts` table.
  3. Collect all unique project UUIDs from `metadata.references.projects` across results and resolve them to project names via a single batch query to the `projects` table.
  4. Return results sorted by similarity descending, each showing similarity percentage, capture date, type, topics, people, action items, reliability, author, project names, and content.

The `search_thoughts` tool description MUST include a CRITICAL directive instructing the model to call `record_useful_thoughts` before its next user-facing response (with an empty array if none contributed) and to scan results for contradictions or clearly outdated information and flag them to the user without archiving silently.

When results are returned, the response text payload SHALL begin with a header block (before any result summary or result body) containing:
  - A visually prominent prefix line (`⚠️ REQUIRED BEFORE NEXT USER RESPONSE:` or equivalent)
  - Numbered action items stating (1) call `record_useful_thoughts` with contributing IDs or empty array, (2) scan for contradictions and outdated data, surface to user, do not archive silently
  - A `Candidate IDs from this search:` line listing the UUIDs of all returned thoughts as a JSON array
  - A `--- Results ---` separator before the existing results body

#### Scenario: search_thoughts displays reliability and author
- **WHEN** `search_thoughts` is called and returns results
- **THEN** each result SHALL include the thought's `reliability` value and `author` value

#### Scenario: search_thoughts displays project names
- **WHEN** `search_thoughts` returns thoughts that have `metadata.references.projects` containing valid project UUIDs
- **THEN** the output SHALL display the resolved project names (not raw UUIDs)

#### Scenario: search_thoughts with thought that has no reliability or author
- **WHEN** `search_thoughts` returns a thought where both `reliability` and `author` are null
- **THEN** the output SHALL omit the reliability/author line for that result

#### Scenario: search_thoughts with thought that has no project references
- **WHEN** `search_thoughts` returns a thought with no `metadata.references.projects`
- **THEN** the output SHALL not display a projects line for that result

#### Scenario: search_thoughts tool description includes CRITICAL directive
- **WHEN** an MCP client reads the `search_thoughts` tool description
- **THEN** the description SHALL contain the substring "CRITICAL"
- **AND** SHALL instruct the model to call `record_useful_thoughts` before the next user-facing response
- **AND** SHALL instruct the model to pass an empty array if none of the returned thoughts contributed
- **AND** SHALL instruct the model to flag contradictions or outdated thoughts to the user without archiving silently

#### Scenario: search_thoughts reminder appears as header
- **WHEN** `search_thoughts` returns one or more results
- **THEN** the first non-empty line of the text payload SHALL be the `⚠️ REQUIRED BEFORE NEXT USER RESPONSE:` prefix (or equivalent visually prominent marker)
- **AND** the header SHALL appear before the `Found N thought(s):` summary line
- **AND** the header SHALL appear before any result block
- **AND** the `--- Results ---` separator SHALL appear between the header and the first result

#### Scenario: search_thoughts header lists candidate IDs
- **WHEN** `search_thoughts` returns results with IDs `['uuid-1', 'uuid-2']`
- **THEN** the header SHALL contain the line `Candidate IDs from this search: ["uuid-1","uuid-2"]` (or equivalent JSON array)

#### Scenario: search_thoughts no longer emits footer reminder
- **WHEN** `search_thoughts` returns one or more results
- **THEN** the text payload SHALL NOT contain the legacy footer `Reminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs:` string after the result blocks

When no thoughts exceed the similarity threshold, the tool SHALL return the string `No thoughts found matching "{query}".`

#### Scenario: No thoughts match threshold
- **WHEN** `search_thoughts` is called with a query and no thoughts exceed `threshold`
- **THEN** the tool SHALL return `No thoughts found matching "{query}".`

---

### list_thoughts

GIVEN the MCP server is running
WHEN a client calls `list_thoughts` with optional filters: `limit` (default 10), `type`, `topic`, `person`, `days`, `project_id`
THEN the system:
  1. Queries `thoughts` ordered by created_at descending
  2. Applies filters via jsonb `contains` (type, topic, person, project_id) and date range (days)
  3. Collects all unique project UUIDs from `metadata.references.projects` across results and resolves them to project names via a single batch query to the `projects` table
  4. Returns numbered list with date, type, topics, reliability, author, project names, and content

#### Scenario: list_thoughts with project_id filter
- **WHEN** `list_thoughts` is called with `project_id = 'uuid-A'`
- **THEN** the system SHALL return only thoughts whose `metadata.references.projects` array contains `uuid-A`

#### Scenario: list_thoughts with project_id that has no thoughts
- **WHEN** `list_thoughts` is called with `project_id = 'uuid-nonexistent'`
- **THEN** the system SHALL return "No thoughts found."

#### Scenario: list_thoughts with project_id combined with other filters
- **WHEN** `list_thoughts` is called with `project_id = 'uuid-A'` and `type = 'observation'`
- **THEN** the system SHALL return only thoughts that match BOTH filters (project AND type)

#### Scenario: list_thoughts displays reliability and author
- **WHEN** `list_thoughts` is called and returns results
- **THEN** each thought in the output SHALL include its `reliability` value and `author` value

#### Scenario: list_thoughts displays project names
- **WHEN** `list_thoughts` returns thoughts that have `metadata.references.projects` containing valid project UUIDs
- **THEN** the output SHALL display the resolved project names (not raw UUIDs)

#### Scenario: list_thoughts with thought that has no reliability or author
- **WHEN** `list_thoughts` returns a thought where both `reliability` and `author` are null
- **THEN** the output SHALL omit the reliability/author line for that thought

#### Scenario: list_thoughts with thought that has no project references
- **WHEN** `list_thoughts` returns a thought with no `metadata.references.projects`
- **THEN** the output SHALL not display a projects line for that thought

---

### thought_stats

GIVEN the MCP server is running
WHEN a client calls `thought_stats` with optional `project_id` filter
THEN the system:
  1. Gets total thought count (scoped to project if `project_id` provided)
  2. Fetches all metadata and created_at values (scoped to project if `project_id` provided)
  3. Aggregates: type counts, top 10 topics, top 10 people mentioned
  4. Returns formatted summary with total count, date range, type breakdown, top topics, and people

#### Scenario: thought_stats with project_id filter
- **WHEN** `thought_stats` is called with `project_id = 'uuid-A'`
- **THEN** the system SHALL return statistics scoped only to thoughts whose `metadata.references.projects` array contains `uuid-A`

#### Scenario: thought_stats without project_id filter
- **WHEN** `thought_stats` is called without `project_id`
- **THEN** the system SHALL return statistics across all thoughts (existing behavior)

#### Scenario: thought_stats with project_id that has no thoughts
- **WHEN** `thought_stats` is called with `project_id` for a project with no linked thoughts
- **THEN** the system SHALL return a total count of 0

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

---

### match_thoughts RPC returns reliability and author

The `match_thoughts` database function SHALL include `reliability` and `author` columns in its return type and SELECT clause, so that callers can access provenance information without a second query.

#### Scenario: match_thoughts returns reliability and author
- **WHEN** `match_thoughts` is called
- **THEN** each result row SHALL include `reliability` (text, nullable) and `author` (text, nullable) fields

---

### Project name resolution in thought output

When rendering thought results for `list_thoughts` or `search_thoughts`, the system SHALL resolve project UUIDs from `metadata.references.projects` to human-readable project names by querying the `projects` table. Resolution SHALL be done in a single batch query per tool call, not per-thought.

#### Scenario: Project UUID resolves to name
- **WHEN** a thought has `metadata.references.projects = ['uuid-A']` and the projects table contains a project with `id = 'uuid-A'` and `name = 'TerrestrialBrain'`
- **THEN** the output SHALL display `Projects: TerrestrialBrain`

#### Scenario: Project UUID cannot be resolved
- **WHEN** a thought has `metadata.references.projects = ['uuid-orphaned']` and no project exists with that ID
- **THEN** the output SHALL display the raw UUID as fallback: `Projects: uuid-orphaned`

---

### Requirement: Thought mutability

Thoughts in the `thoughts` table SHALL support updates via the `update_thought` MCP tool in addition to creation via `capture_thought` and `ingest_note`. The `updated_at` column (auto-managed by database trigger) SHALL reflect the most recent modification time.

#### Scenario: Thought updated_at reflects edits

- **WHEN** a thought is updated via `update_thought`
- **THEN** the `updated_at` column SHALL be automatically updated by the database trigger
- **AND** the `created_at` column SHALL remain unchanged

---

### Requirement: record_useful_thoughts MCP tool

The MCP server SHALL expose a `record_useful_thoughts` tool that increments the `usefulness_score` of a batch of thought UUIDs via the `increment_usefulness(uuid[])` RPC. The input schema SHALL accept an array of UUID strings with a minimum length of 0 (an empty array is valid input). The tool SHALL return a confirmation string reporting the number of thoughts actually incremented (i.e., matched by ID in the `thoughts` table) and the number of IDs provided.

The tool description SHALL instruct the model that this call is required after every `search_thoughts` call, that an empty array is the correct input when no returned thought contributed to the answer, and that calling it acknowledges the scan regardless of outcome.

#### Scenario: record_useful_thoughts with useful IDs
- **WHEN** `record_useful_thoughts` is called with `thought_ids = ['uuid-A', 'uuid-B']` where both exist in the `thoughts` table
- **THEN** the `usefulness_score` of both thoughts SHALL be incremented by 1
- **AND** the tool SHALL return "Recorded usefulness for 2 thought(s) out of 2 provided."

#### Scenario: record_useful_thoughts with empty array
- **WHEN** `record_useful_thoughts` is called with `thought_ids = []`
- **THEN** the tool SHALL return successfully (no `isError: true`)
- **AND** the response text SHALL be "Recorded usefulness for 0 thought(s) out of 0 provided."
- **AND** no thought's `usefulness_score` SHALL change

#### Scenario: record_useful_thoughts with mix of valid and invalid UUIDs
- **WHEN** `record_useful_thoughts` is called with `thought_ids = ['uuid-existing', 'uuid-not-in-db']`
- **THEN** only the existing thought's `usefulness_score` SHALL be incremented
- **AND** the tool SHALL return "Recorded usefulness for 1 thought(s) out of 2 provided."

#### Scenario: record_useful_thoughts with malformed UUID rejected at schema layer
- **WHEN** `record_useful_thoughts` is called with `thought_ids = ['not-a-uuid']`
- **THEN** the MCP layer SHALL reject the call with a Zod validation error before invoking the RPC
- **AND** no thought's `usefulness_score` SHALL change
