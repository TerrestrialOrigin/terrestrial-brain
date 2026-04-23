## MODIFIED Requirements

### Requirement: capture_thought

The `capture_thought` MCP tool SHALL accept a required `content` string, and optional `author` string, `project_ids` UUID array, `document_ids` UUID array, and `builds_on` UUID array.

When invoked, the tool SHALL:
  1. Run the structural parser on `content` to produce a `ParsedNote`.
  2. Run the extractor pipeline (ProjectExtractor, PeopleExtractor, TaskExtractor) to produce `references`.
  3. If `project_ids` is provided, merge those UUIDs into `references.projects` as a union with pipeline-detected projects (no duplicates).
  4. If `document_ids` is provided, merge those UUIDs into `references.documents` as a union (no duplicates).
  5. Generate a 1536-dim embedding via OpenRouter (text-embedding-3-small).
  6. Extract metadata via OpenRouter (gpt-4o-mini).
  7. Insert a row into `thoughts` with `source="mcp"`, `reference_id=null`, `note_snapshot_id=null`, `metadata.references` from steps 2-4, `reliability="reliable"`, and `author` set to the provided value or null.
  8. If `builds_on` is provided and non-empty, the tool SHALL call the `increment_usefulness(uuid[])` RPC with the provided UUIDs as a best-effort side effect AFTER the insert succeeds. A failure of this side effect MUST NOT roll back the insert, MUST be logged server-side, and SHALL be reported in the confirmation string.
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

### Requirement: search_thoughts

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

## ADDED Requirements

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
