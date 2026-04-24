## MODIFIED Requirements

### Requirement: search_thoughts

The `search_thoughts` MCP tool SHALL accept a required `query` string, an optional `limit` (default 10), an optional `threshold` (default 0.5), an optional `author` filter, and an optional `reliability` filter.

When invoked, the tool SHALL:
  1. Generate an embedding for the query.
  2. Call the `match_thoughts` RPC to perform a cosine similarity search over the `thoughts` table.
  3. Collect all unique project UUIDs from `metadata.references.projects` across results and resolve them to project names via a single batch query to the `projects` table.
  4. Return results sorted by similarity descending, each showing similarity percentage, capture date, type, topics, people, action items, reliability, author, project names, and content.

The `search_thoughts` tool description MUST include a CRITICAL directive instructing the model to call `record_useful_thoughts` before its next user-facing response (with an empty array if none contributed) and to scan results for contradictions or clearly outdated information and flag them to the user without archiving silently.

When results are returned, the response text payload SHALL carry a **hard-tier** usefulness reminder in **both** a header block (before the result summary and body) and a matching footer block (after the last result). Each copy SHALL contain:
  - A visually prominent prefix line (`⚠️ REQUIRED BEFORE NEXT USER RESPONSE:` or equivalent)
  - Numbered action items stating (1) call `record_useful_thoughts` with contributing IDs or empty array, (2) scan for contradictions and outdated data, surface to user, do not archive silently
  - A reinforcement line emphasizing that the call must not be skipped and that an empty array is the correct input when nothing was useful. The empty-array parenthetical SHALL appear twice in the reinforcement line — once on the "NEVER skip" clause and once on the "ALWAYS do" clause — and MUST NOT be deduplicated.
  - A `Candidate IDs from this search:` line listing the UUIDs of all returned thoughts as a JSON array

The header SHALL be separated from the results body by a `--- Results ---` separator.

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

#### Scenario: search_thoughts reminder also appears as footer
- **WHEN** `search_thoughts` returns one or more results
- **THEN** the text payload SHALL contain a second copy of the `⚠️ REQUIRED BEFORE NEXT USER RESPONSE:` reminder block positioned after the last result
- **AND** the footer copy SHALL include the same `Candidate IDs from this search:` JSON array line as the header

#### Scenario: search_thoughts header lists candidate IDs
- **WHEN** `search_thoughts` returns results with IDs `['uuid-1', 'uuid-2']`
- **THEN** the header SHALL contain the line `Candidate IDs from this search: ["uuid-1","uuid-2"]` (or equivalent JSON array)

#### Scenario: search_thoughts no longer emits legacy single-line footer
- **WHEN** `search_thoughts` returns one or more results
- **THEN** the text payload SHALL NOT contain the legacy footer `Reminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs:` string after the result blocks

#### Scenario: search_thoughts reminder repeats empty-array parenthetical
- **WHEN** the `search_thoughts` reminder block is rendered (header or footer)
- **THEN** the reinforcement line SHALL contain the phrase "if no thoughts were found useful, pass in an empty array" exactly twice within the same line — once on a "NEVER skip" clause and once on an "ALWAYS do" clause

When no thoughts exceed the similarity threshold, the tool SHALL return the string `No thoughts found matching "{query}".`

#### Scenario: No thoughts match threshold
- **WHEN** `search_thoughts` is called with a query and no thoughts exceed `threshold`
- **THEN** the tool SHALL return `No thoughts found matching "{query}".`

---

### Requirement: list_thoughts

The `list_thoughts` MCP tool SHALL accept optional filters: `limit` (default 10), `type`, `topic`, `person`, `days`, `project_id`, `author`, `reliability`, and `include_archived`.

When invoked, the tool SHALL:
  1. Query `thoughts` ordered by created_at descending, excluding archived thoughts unless `include_archived` is true.
  2. Apply filters via jsonb `contains` (type, topic, person, project_id), equality (author, reliability), and date range (days).
  3. Collect all unique project UUIDs from `metadata.references.projects` across results and resolve them to project names via a single batch query to the `projects` table.
  4. Return a numbered list with date, type, topics, reliability, author, project names, and content.

The `list_thoughts` tool description MUST include a CRITICAL directive instructing the model to call `record_useful_thoughts` before its next user-facing response (with an empty array if none contributed, explicitly acknowledging that empty arrays are the expected input during browsing) and to scan results for contradictions or clearly outdated information and flag them to the user without archiving silently.

When results are returned (non-empty), the response text payload SHALL carry a **soft-tier** usefulness reminder in **both** a header block (before the result summary and body) and a matching footer block (after the last result). Each copy SHALL contain:
  - A visually prominent prefix line (`⚠️ BEFORE NEXT USER RESPONSE:` or equivalent — softer than the `search_thoughts` `REQUIRED` wording, explicitly naming browsing as a valid no-op)
  - An instruction to call `record_useful_thoughts` with contributing IDs if any thought contributed
  - An explicit acknowledgement that an empty array is the correct input when browsing without picking
  - An instruction to scan for contradictions/outdated data and surface to user without archiving silently
  - A `Candidate IDs from this list:` line listing the UUIDs of all returned thoughts as a JSON array

The header SHALL be separated from the results body by a `--- Results ---` separator.

When **no** thoughts match the filter, the tool SHALL return the plain string `"No thoughts found."` with **no** header, **no** footer, and **no** usefulness reminder attached.

#### Scenario: list_thoughts with project_id filter
- **WHEN** `list_thoughts` is called with `project_id = 'uuid-A'`
- **THEN** the system SHALL return only thoughts whose `metadata.references.projects` array contains `uuid-A`

#### Scenario: list_thoughts with project_id that has no thoughts
- **WHEN** `list_thoughts` is called with `project_id = 'uuid-nonexistent'`
- **THEN** the system SHALL return "No thoughts found."
- **AND** the response SHALL NOT include a usefulness reminder header or footer

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

#### Scenario: list_thoughts non-empty results carry soft header and footer
- **WHEN** `list_thoughts` returns one or more results
- **THEN** the first non-empty line of the text payload SHALL be the `⚠️ BEFORE NEXT USER RESPONSE:` prefix (or equivalent visually prominent marker)
- **AND** the text payload SHALL contain a second copy of the same reminder block positioned after the last result
- **AND** both copies SHALL include the `Candidate IDs from this list:` JSON array line
- **AND** the `--- Results ---` separator SHALL appear between the header and the first result

#### Scenario: list_thoughts empty results have no reminder
- **WHEN** `list_thoughts` returns zero results (no thoughts match the filter)
- **THEN** the response text SHALL equal `"No thoughts found."` exactly
- **AND** SHALL NOT contain the `⚠️ BEFORE NEXT USER RESPONSE:` prefix
- **AND** SHALL NOT contain the `Candidate IDs` line

#### Scenario: list_thoughts no longer emits legacy single-line reminder
- **WHEN** `list_thoughts` returns one or more results
- **THEN** the text payload SHALL NOT contain the legacy line `Reminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs:`

#### Scenario: list_thoughts tool description includes CRITICAL directive
- **WHEN** an MCP client reads the `list_thoughts` tool description
- **THEN** the description SHALL contain the substring "CRITICAL"
- **AND** SHALL instruct the model to call `record_useful_thoughts` before the next user-facing response
- **AND** SHALL instruct the model to pass an empty array when browsing without a specific pick
- **AND** SHALL instruct the model to flag contradictions or outdated thoughts to the user without archiving silently

## ADDED Requirements

### Requirement: get_thought_by_id auto-records usefulness on successful fetch

The `get_thought_by_id` MCP tool SHALL, after a successful retrieval of a single thought, invoke the `increment_usefulness(uuid[])` RPC with a single-element array containing the fetched thought's ID. This is a server-enforced signal: the tool does NOT require or prompt the model to call `record_useful_thoughts` for the fetched ID.

The usefulness increment SHALL NOT be reflected in the tool's text output — the fetch response is unchanged. If the RPC call fails, the error SHALL be logged via `console.error` and swallowed; the primary fetch response MUST still be returned to the caller successfully. The fetch itself is the primary operation; the score bump is secondary bookkeeping.

When the fetch fails (thought not found, DB error), no usefulness score SHALL change.

#### Scenario: Successful get_thought_by_id bumps usefulness by exactly 1
- **WHEN** `get_thought_by_id` is called with an `id` that matches an existing thought in the `thoughts` table
- **THEN** the thought's `usefulness_score` SHALL be incremented by exactly 1
- **AND** the tool SHALL return the thought's content and metadata unchanged (no reminder, no mention of scoring)

#### Scenario: get_thought_by_id on unknown UUID does not touch any score
- **WHEN** `get_thought_by_id` is called with an `id` that does not match any thought
- **THEN** the tool SHALL return a `No thought found with ID "..."` message
- **AND** no thought's `usefulness_score` SHALL change

#### Scenario: Auto-record RPC failure does not break the fetch
- **WHEN** `get_thought_by_id` successfully retrieves a thought but the subsequent `increment_usefulness` RPC call returns an error
- **THEN** the tool SHALL still return the thought's content and metadata to the caller
- **AND** the RPC error SHALL be logged server-side (via `console.error`)
- **AND** the response SHALL NOT be marked `isError: true`

#### Scenario: get_thought_by_id output contains no usefulness reminder
- **WHEN** `get_thought_by_id` returns a thought
- **THEN** the text payload SHALL NOT contain a `⚠️` reminder prefix or any `Candidate IDs` line — the scoring signal is invisible to the model by design
