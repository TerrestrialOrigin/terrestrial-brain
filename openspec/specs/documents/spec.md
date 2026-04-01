### Requirement: Documents table stores full long-form content linked to a project

The system SHALL provide a `documents` table in Supabase that stores full markdown documents verbatim. Each document SHALL have a required `project_id` foreign key referencing the `projects` table. The table SHALL include columns: `id` (uuid, primary key), `project_id` (uuid, not null, FK), `title` (text, not null), `content` (text, not null), `file_path` (text, nullable), `references` (jsonb, default `{"people": [], "tasks": []}`), `created_at` (timestamptz), `updated_at` (timestamptz). The table SHALL have RLS enabled with a service_role full-access policy. An `updated_at` trigger SHALL auto-update on row modification. An index SHALL exist on `project_id`.

#### Scenario: Document row created with all fields
- **WHEN** a row is inserted into `documents` with title, content, project_id, file_path, and references
- **THEN** the row is persisted with all fields, `id` is auto-generated, `created_at` and `updated_at` are set to now

#### Scenario: Document requires valid project
- **WHEN** a row is inserted with a `project_id` that does not exist in the `projects` table
- **THEN** the insert fails with a foreign key violation

#### Scenario: Document updated_at auto-updates
- **WHEN** a document row is updated
- **THEN** the `updated_at` column is automatically set to the current timestamp

#### Scenario: RLS restricts access to service_role
- **WHEN** a query is made with the anon key
- **THEN** no rows are returned (RLS policy only allows service_role)

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

### Requirement: get_document MCP tool retrieves a full document by ID

The system SHALL expose a `get_document` MCP tool that accepts `id` (string, required) and returns the full document row including content. The response SHALL include id, title, content, project_id, file_path, references, created_at, and updated_at.

#### Scenario: Retrieve existing document
- **WHEN** `get_document` is called with a valid document UUID
- **THEN** the full document row is returned including the complete content body

#### Scenario: Document not found
- **WHEN** `get_document` is called with a UUID that does not exist in the `documents` table
- **THEN** the tool returns an error message indicating the document was not found

### Requirement: list_documents MCP tool lists documents with optional project filter

The system SHALL expose a `list_documents` MCP tool that accepts `project_id` (string, optional), `title_contains` (string, optional), `search` (string, optional), and `limit` (number, optional, default 20). The tool SHALL return document metadata without the content body. Each result SHALL include id, title, project_id, file_path, references, created_at, and updated_at. Results SHALL be ordered by `created_at` descending.

When `title_contains` is provided, the tool SHALL filter results to documents whose title contains the given substring, case-insensitively (Postgres `ILIKE '%value%'`).

When `search` is provided, the tool SHALL filter results to documents whose content contains the given substring, case-insensitively (Postgres `ILIKE '%value%'`).

All filters (`project_id`, `title_contains`, `search`) SHALL be combinable using AND logic. The MCP tool description SHALL document all available parameters.

#### Scenario: List all documents
- **WHEN** `list_documents` is called with no parameters
- **THEN** up to 20 documents are returned ordered by created_at descending, without the content field

#### Scenario: List documents filtered by project
- **WHEN** `list_documents` is called with a valid `project_id`
- **THEN** only documents belonging to that project are returned

#### Scenario: Filter documents by title substring
- **WHEN** `list_documents` is called with `title_contains: "sprint"`
- **THEN** only documents whose title contains "sprint" (case-insensitive) are returned

#### Scenario: Title filter is case-insensitive
- **WHEN** `list_documents` is called with `title_contains: "Sprint"` and a document exists with title "Q1 sprint plan"
- **THEN** the document is included in results

#### Scenario: Search documents by content substring
- **WHEN** `list_documents` is called with `search: "deployment"`
- **THEN** only documents whose content contains "deployment" (case-insensitive) are returned
- **THEN** the content body is NOT included in the response (metadata only)

#### Scenario: Combine project filter with title filter
- **WHEN** `list_documents` is called with `project_id: "<uuid>"` and `title_contains: "plan"`
- **THEN** only documents belonging to that project whose title contains "plan" are returned

#### Scenario: Combine all three filters
- **WHEN** `list_documents` is called with `project_id: "<uuid>"`, `title_contains: "sprint"`, and `search: "milestone"`
- **THEN** only documents matching all three criteria are returned

#### Scenario: No documents match filters
- **WHEN** `list_documents` is called with `title_contains: "nonexistent-string-xyz"`
- **THEN** the tool returns a "No documents found" message

#### Scenario: List includes project name for context
- **WHEN** `list_documents` is called and results are returned
- **THEN** each document entry includes the project name (resolved from the project_id foreign key) for readability

### Requirement: capture_thought accepts document_ids to link thoughts back to source documents

The `capture_thought` MCP tool SHALL accept an optional `document_ids` parameter (array of UUID strings). When provided, the UUIDs SHALL be merged into `metadata.references.documents` alongside any other pipeline-detected references, using the same union/dedup pattern as `project_ids`. The MCP description for `capture_thought` SHALL mention the `document_ids` parameter.

#### Scenario: Thought captured with document_ids
- **WHEN** `capture_thought` is called with content and `document_ids: ["doc-uuid-1"]`
- **THEN** the inserted thought's `metadata.references.documents` contains `["doc-uuid-1"]`
- **THEN** all other metadata extraction (topics, people, projects) proceeds normally

#### Scenario: Thought captured without document_ids
- **WHEN** `capture_thought` is called without the `document_ids` parameter
- **THEN** `metadata.references.documents` is not added (or is empty)
- **THEN** behavior is identical to the existing capture_thought

#### Scenario: write_document response guides AI to link thoughts
- **WHEN** `write_document` completes successfully
- **THEN** the response text includes the document UUID and instructs the AI to pass it as `document_ids` when calling `capture_thought`
