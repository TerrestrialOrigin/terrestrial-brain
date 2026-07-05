# update_document

## Purpose

Provide an `update_document` MCP tool that updates an existing document's title, content, or project assignment, re-running extraction and soft-archiving linked thoughts when content changes, while ensuring a failed document update never destroys linked thoughts.

## Requirements

### Requirement: update_document MCP tool updates an existing document

The system SHALL expose an `update_document` MCP tool that accepts `id` (string, required), `title` (string, optional), `content` (string, optional), and `project_id` (string, optional). At least one of `title`, `content`, or `project_id` MUST be provided. The tool SHALL update the specified document row and return confirmation of which fields were updated.

When new `content` is provided, the tool SHALL update the document FIRST and perform thought cleanup (soft-archive) only AFTER the document update succeeds, so that a failed document update never destroys or archives linked thoughts.

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
- **THEN** the extraction pipeline runs on the new content to produce fresh references
- **THEN** the document's `content` and `references` columns are updated
- **THEN** after the document update succeeds, all thoughts whose `metadata.references.documents` contains this document's UUID are soft-archived (their `archived_at` is set) — not deleted
- **THEN** the response includes `thoughts_required: true` and instructs the AI to re-capture thoughts using `capture_thought` with `document_ids: ["<id>"]`

#### Scenario: Update content and title together
- **WHEN** `update_document` is called with `id`, `content`, and `title`
- **THEN** both fields are updated in a single database operation
- **THEN** thought cleanup (soft-archive) and re-extraction occur (because content changed)
- **THEN** the extraction pipeline uses the new title for context

#### Scenario: Update all fields together
- **WHEN** `update_document` is called with `id`, `title`, `content`, and `project_id`
- **THEN** all three fields are updated
- **THEN** thought cleanup (soft-archive) and re-extraction occur (because content changed)

#### Scenario: Document update failure leaves thoughts untouched
- **WHEN** `update_document` is called with new `content` but the document update fails (e.g. an invalid `project_id` foreign key)
- **THEN** the tool returns an error and no linked thought is archived or deleted — the existing thoughts remain active and consistent with the unchanged document content

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

### Requirement: Thought cleanup archives only thoughts linked to the updated document

When `update_document` receives new content, the system SHALL soft-archive (set `archived_at = now()`, never `DELETE`) thoughts linked to the document, and SHALL do so only after the document update has succeeded. The query SHALL match thoughts where `metadata->'references'->'documents'` contains the document UUID. Thoughts not referencing this document SHALL be unaffected. If the cleanup archive operation returns an error, the tool SHALL surface a warning in its result rather than silently swallowing the failure.

#### Scenario: Stale thoughts archived on content update
- **WHEN** `update_document` is called with new content for a document that has 3 linked thoughts
- **THEN** all 3 thoughts whose `metadata.references.documents` contains the document UUID have `archived_at` set (still present in the table, not deleted)
- **THEN** thoughts linked to other documents are not affected

#### Scenario: No linked thoughts exist
- **WHEN** `update_document` is called with new content for a document that has no linked thoughts
- **THEN** the archive query runs without error (no-op)
- **THEN** the document is updated normally

#### Scenario: Cleanup failure is surfaced
- **WHEN** `update_document` updates the document successfully but the subsequent thought-archive operation returns an error
- **THEN** the tool result SHALL include a warning indicating that thought cleanup failed (stale thoughts may remain active)
- **THEN** the failure SHALL NOT be limited to a `console.error` with no caller-visible signal
