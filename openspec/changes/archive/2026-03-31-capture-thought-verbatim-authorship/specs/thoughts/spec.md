## MODIFIED Requirements

### capture_thought

GIVEN the MCP server is running
WHEN a client calls `capture_thought` with a `content` string, optional `author` string, and optional `project_ids` UUID array
THEN the system:
  1. Runs structural parser on content to produce a `ParsedNote`
  2. Runs the extractor pipeline (ProjectExtractor, PeopleExtractor, TaskExtractor) to produce `references`
  3. If `project_ids` is provided, merges those UUIDs into `references.projects` (union with pipeline-detected projects, no duplicates)
  4. Generates a 1536-dim embedding via OpenRouter (text-embedding-3-small)
  5. Extracts metadata via OpenRouter (gpt-4o-mini)
  6. Inserts a row into `thoughts` with source="mcp", reference_id=null, note_snapshot_id=null, metadata.references from steps 2-3, reliability="reliable", author=provided value or null
  7. Returns a confirmation string

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

GIVEN embedding or metadata extraction fails
WHEN `capture_thought` is called
THEN the tool returns an error message with `isError: true`
