## MODIFIED Requirements

### Requirement: list_thoughts

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

### Requirement: search_thoughts

GIVEN the MCP server is running
WHEN a client calls `search_thoughts` with a `query` string, optional `limit` (default 10), optional `threshold` (default 0.5)
THEN the system:
  1. Generates an embedding for the query
  2. Calls `match_thoughts` RPC: cosine similarity search on the `thoughts` table
  3. Collects all unique project UUIDs from `metadata.references.projects` across results and resolves them to project names via a single batch query to the `projects` table
  4. Returns results sorted by similarity descending, each showing:
     - Similarity percentage, capture date, type, topics, people, action items, reliability, author, project names, and content

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

---

### Requirement: thought_stats

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

## ADDED Requirements

### Requirement: match_thoughts RPC returns reliability and author

The `match_thoughts` database function SHALL include `reliability` and `author` columns in its return type and SELECT clause, so that callers can access provenance information without a second query.

#### Scenario: match_thoughts returns reliability and author
- **WHEN** `match_thoughts` is called
- **THEN** each result row SHALL include `reliability` (text, nullable) and `author` (text, nullable) fields

### Requirement: Project name resolution in thought output

When rendering thought results for `list_thoughts` or `search_thoughts`, the system SHALL resolve project UUIDs from `metadata.references.projects` to human-readable project names by querying the `projects` table. Resolution SHALL be done in a single batch query per tool call, not per-thought.

#### Scenario: Project UUID resolves to name
- **WHEN** a thought has `metadata.references.projects = ['uuid-A']` and the projects table contains a project with `id = 'uuid-A'` and `name = 'TerrestrialBrain'`
- **THEN** the output SHALL display `Projects: TerrestrialBrain`

#### Scenario: Project UUID cannot be resolved
- **WHEN** a thought has `metadata.references.projects = ['uuid-orphaned']` and no project exists with that ID
- **THEN** the output SHALL display the raw UUID as fallback: `Projects: uuid-orphaned`
