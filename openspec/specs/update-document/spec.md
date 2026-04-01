### Requirement: update_document MCP tool updates an existing document

The system SHALL expose an `update_document` MCP tool that accepts `id` (string, required), `title` (string, optional), `content` (string, optional), and `project_id` (string, optional). At least one of `title`, `content`, or `project_id` MUST be provided. The tool SHALL update the specified document row and return confirmation of which fields were updated.

#### Scenario: Update title only
- **WHEN** `update_document` is called with `id` and `title` only
- **THEN** the document's title is updated to the new value
- **THEN** the `updated_at` timestamp is refreshed
- **THEN** no thought cleanup or re-extraction occurs
- **THEN** the response confirms the title was updated

#### Scenario: Update project_id only
- **WHEN** `update_document` is called with `id` and `project_id` only
- **THEN** the document's project_id is updated to the new value
- **THEN** no thought cleanup or re-extraction occurs
- **THEN** the response confirms the project assignment was updated

#### Scenario: Update content triggers thought cleanup and re-extraction
- **WHEN** `update_document` is called with `id` and `content`
- **THEN** all thoughts whose `metadata.references.documents` contains this document's UUID are deleted
- **THEN** the extraction pipeline runs on the new content to produce fresh references
- **THEN** the document's `content` and `references` columns are updated
- **THEN** the response includes `thoughts_required: true` and instructs the AI to re-capture thoughts using `capture_thought` with `document_ids: ["<id>"]`

#### Scenario: Update content and title together
- **WHEN** `update_document` is called with `id`, `content`, and `title`
- **THEN** both fields are updated in a single database operation
- **THEN** thought cleanup and re-extraction occur (because content changed)
- **THEN** the extraction pipeline uses the new title for context

#### Scenario: Update all fields together
- **WHEN** `update_document` is called with `id`, `title`, `content`, and `project_id`
- **THEN** all three fields are updated
- **THEN** thought cleanup and re-extraction occur (because content changed)

#### Scenario: No optional fields provided
- **WHEN** `update_document` is called with only `id` and no optional fields
- **THEN** the tool returns a validation error: "At least one of title, content, or project_id must be provided"

#### Scenario: Document not found
- **WHEN** `update_document` is called with an `id` that does not exist in the documents table
- **THEN** the tool returns an error: "Document not found"

#### Scenario: Invalid project_id
- **WHEN** `update_document` is called with a `project_id` that does not exist in the projects table
- **THEN** the tool returns an error indicating the foreign key constraint was violated

#### Scenario: Content stored verbatim
- **WHEN** `update_document` is called with new `content`
- **THEN** the `content` column in the updated row is byte-for-byte identical to the input

#### Scenario: Extraction pipeline failure is non-fatal
- **WHEN** `update_document` is called with new `content` and the extraction pipeline throws an error
- **THEN** the document is still updated with the new content
- **THEN** the `references` column is set to `{"people": [], "tasks": []}`
- **THEN** a warning is included in the response

### Requirement: Thought cleanup deletes only thoughts linked to the updated document

When `update_document` receives new content, the system SHALL delete thoughts linked to the document before updating. The query SHALL match thoughts where `metadata->'references'->'documents'` contains the document UUID. Thoughts not referencing this document SHALL be unaffected.

#### Scenario: Stale thoughts deleted on content update
- **WHEN** `update_document` is called with new content for a document that has 3 linked thoughts
- **THEN** all 3 thoughts whose `metadata.references.documents` contains the document UUID are deleted
- **THEN** thoughts linked to other documents are not affected

#### Scenario: No linked thoughts exist
- **WHEN** `update_document` is called with new content for a document that has no linked thoughts
- **THEN** the delete query runs without error (no-op)
- **THEN** the document is updated normally
