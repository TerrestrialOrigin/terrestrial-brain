## RENAMED Requirements

- FROM: `### Requirement: match_thoughts RPC returns reliability and author`
- TO: `### Requirement: search_thoughts_by_embedding RPC returns reliability and author`

## MODIFIED Requirements

### Requirement: search_thoughts

The `search_thoughts` MCP tool SHALL accept a required `query` string, an optional `limit` (default 10), an optional `threshold` (default 0.5), an optional `author` filter, and an optional `reliability` filter.

When invoked, the tool SHALL:
  1. Generate an embedding for the query.
  2. Call the `search_thoughts_by_embedding` RPC to perform a cosine similarity search over the `thoughts` table.
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

### Requirement: search_thoughts_by_embedding RPC returns reliability and author

The `search_thoughts_by_embedding` database function SHALL include `reliability` and `author` columns in its return type and SELECT clause, so that callers can access provenance information without a second query.

#### Scenario: search_thoughts_by_embedding returns reliability and author
- **WHEN** `search_thoughts_by_embedding` is called
- **THEN** each result row SHALL include `reliability` (text, nullable) and `author` (text, nullable) fields
