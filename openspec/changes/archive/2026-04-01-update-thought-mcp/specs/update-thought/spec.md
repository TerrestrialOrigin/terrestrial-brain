## ADDED Requirements

### Requirement: update_thought MCP tool

The MCP server SHALL expose an `update_thought` tool that allows clients to modify existing thoughts. The tool SHALL accept a required `id` (UUID) and one or more optional fields: `content` (string), `reliability` (string), `author` (string), `project_ids` (string array), `document_ids` (string array).

At least one optional field MUST be provided; otherwise the tool SHALL return a validation error with `isError: true`.

#### Scenario: Validation error when no optional fields provided

- **WHEN** `update_thought` is called with only `id` and no other fields
- **THEN** the tool SHALL return an error message stating at least one field must be provided, with `isError: true`

#### Scenario: Thought not found

- **WHEN** `update_thought` is called with an `id` that does not exist in the `thoughts` table
- **THEN** the tool SHALL return "Thought not found." with `isError: true`

### Requirement: Content update triggers embedding and metadata regeneration

When `content` is provided to `update_thought`, the system SHALL regenerate the 1536-dim embedding via `getEmbedding()` and re-extract metadata via `extractMetadata()` (type, topics, people, action_items, dates_mentioned). The original `created_at`, `reference_id`, `note_snapshot_id`, and `metadata.source` SHALL be preserved.

#### Scenario: Content update regenerates embedding and metadata

- **WHEN** `update_thought` is called with `id` of an existing thought and `content = "New corrected content"`
- **THEN** the thought's `content` SHALL be "New corrected content"
- **AND** the thought's `embedding` SHALL be a freshly generated vector for the new content
- **AND** the thought's metadata `type`, `topics`, `people`, `action_items`, `dates_mentioned` SHALL reflect the new content
- **AND** `metadata.source` SHALL remain unchanged from the original value
- **AND** `created_at` SHALL remain unchanged
- **AND** `updated_at` SHALL reflect the time of the edit

#### Scenario: Content update preserves reference_id and note_snapshot_id

- **WHEN** `update_thought` is called with `content` on a thought that has `reference_id = "path/to/note.md"` and a `note_snapshot_id`
- **THEN** `reference_id` and `note_snapshot_id` SHALL remain unchanged

### Requirement: Non-content updates skip AI processing

When `update_thought` is called with only non-content fields (`reliability`, `author`, `project_ids`, `document_ids`), the system SHALL update those fields directly without calling `getEmbedding()` or `extractMetadata()`.

#### Scenario: Reliability-only update

- **WHEN** `update_thought` is called with `id` and `reliability = "less reliable"` (no content)
- **THEN** the thought's `reliability` SHALL be "less reliable"
- **AND** no embedding regeneration or metadata extraction SHALL occur
- **AND** `updated_at` SHALL reflect the time of the edit

#### Scenario: Author-only update

- **WHEN** `update_thought` is called with `id` and `author = "claude-sonnet-4-6"` (no content)
- **THEN** the thought's `author` SHALL be "claude-sonnet-4-6"
- **AND** no embedding regeneration or metadata extraction SHALL occur

### Requirement: Reference updates use replace semantics

When `project_ids` or `document_ids` are provided, they SHALL fully replace the corresponding arrays in `metadata.references`. This is NOT a merge — the provided array becomes the new value.

#### Scenario: Replace project references

- **WHEN** a thought has `metadata.references.projects = ["uuid-A", "uuid-B"]`
- **AND** `update_thought` is called with `project_ids = ["uuid-C"]`
- **THEN** `metadata.references.projects` SHALL be `["uuid-C"]`

#### Scenario: Clear project references

- **WHEN** a thought has `metadata.references.projects = ["uuid-A"]`
- **AND** `update_thought` is called with `project_ids = []`
- **THEN** `metadata.references.projects` SHALL be `[]`

#### Scenario: Replace document references

- **WHEN** a thought has `metadata.references.documents = ["doc-1"]`
- **AND** `update_thought` is called with `document_ids = ["doc-2", "doc-3"]`
- **THEN** `metadata.references.documents` SHALL be `["doc-2", "doc-3"]`

### Requirement: Combined content and reference update

When both `content` and reference fields (`project_ids`, `document_ids`) are provided, the system SHALL regenerate embedding/metadata for the new content AND apply the explicit reference replacements. Explicit references take precedence over any metadata extraction results.

#### Scenario: Content and project_ids together

- **WHEN** `update_thought` is called with `content = "Updated text"` and `project_ids = ["uuid-X"]`
- **THEN** the embedding and metadata SHALL be regenerated for "Updated text"
- **AND** `metadata.references.projects` SHALL be `["uuid-X"]` (explicit value, not extracted)

### Requirement: Confirmation response

On successful update, the tool SHALL return a human-readable confirmation string describing what was updated.

#### Scenario: Successful content update confirmation

- **WHEN** `update_thought` is called with `content` and the update succeeds
- **THEN** the response SHALL include a confirmation indicating the content was updated and metadata was regenerated

#### Scenario: Successful non-content update confirmation

- **WHEN** `update_thought` is called with only `reliability` and the update succeeds
- **THEN** the response SHALL include a confirmation listing the updated fields

### Requirement: Error handling for AI failures

If embedding generation or metadata extraction fails during a content update, the tool SHALL return an error with `isError: true` and not partially update the thought.

#### Scenario: Embedding failure aborts update

- **WHEN** `update_thought` is called with `content` and `getEmbedding()` throws an error
- **THEN** the thought SHALL remain unchanged in the database
- **AND** the tool SHALL return an error message with `isError: true`
