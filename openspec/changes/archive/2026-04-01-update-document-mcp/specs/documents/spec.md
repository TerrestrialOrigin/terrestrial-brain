## MODIFIED Requirements

### Requirement: write_document MCP tool stores a document and extracts references

The system SHALL expose a `write_document` MCP tool that accepts `title` (string, required), `content` (string, required), `project_id` (string, required), `file_path` (string, optional), and `references` (object with `people` and `tasks` arrays, optional). The tool SHALL insert a row into the `documents` table with content stored verbatim. The response SHALL include the inserted document's `id`, `title`, `project_id`, and a `thoughts_required: true` field. The tool description SHALL mention that existing documents can be edited via `update_document`.

#### Scenario: Document created with explicit references
- **WHEN** `write_document` is called with title, content, project_id, and references containing people and task UUIDs
- **THEN** the document is inserted with the provided references unchanged
- **THEN** the response includes the document id and `thoughts_required: true`

#### Scenario: Document created without references triggers auto-extraction via existing pipeline
- **WHEN** `write_document` is called with title, content, and project_id but no `references` parameter
- **THEN** the system runs the existing extraction pipeline (`runExtractionPipeline` with `ProjectExtractor`, `PeopleExtractor`, `TaskExtractor`) on the content
- **THEN** extracted people, project, and task references are stored in the `references` column
- **THEN** the document is inserted with the extracted references

#### Scenario: Auto-extraction creates new person records for unknown names
- **WHEN** the extraction LLM returns a person name that does not exist in the `people` table
- **THEN** a new `people` row is created with `type='human'` and the extracted name
- **THEN** the new person's UUID is included in `references.people`

#### Scenario: Auto-extraction does not create tasks
- **WHEN** the extraction LLM returns a task description that does not match any existing open task
- **THEN** no new task is created
- **THEN** the unmatched task is omitted from `references.tasks`

#### Scenario: Missing required fields rejected
- **WHEN** `write_document` is called without `title`, `content`, or `project_id`
- **THEN** the MCP framework returns a validation error (Zod schema enforcement)

#### Scenario: Non-existent project_id rejected
- **WHEN** `write_document` is called with a `project_id` that does not exist
- **THEN** the tool returns an error message indicating the project was not found (FK violation)

#### Scenario: Content stored verbatim
- **WHEN** `write_document` is called with any content string
- **THEN** the `content` column in the inserted row is byte-for-byte identical to the input

#### Scenario: Tool description mentions update_document
- **WHEN** the `write_document` tool is registered
- **THEN** its description includes a note that existing documents can be edited using `update_document`
