## MODIFIED Requirements

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
