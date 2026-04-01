## Why

Documents written via `write_document` are currently immutable through the MCP. There's no way to correct errors, update stale content, or reassign documents to different projects without deleting and recreating them — losing the original UUID and breaking any thought references. An `update_document` function closes this gap.

## What Changes

- Add `update_document` MCP tool that accepts `id` (required) plus optional `title`, `content`, and `project_id` fields
- When `content` is updated: delete all thoughts linked to the document (via `metadata->>references` containing the document UUID), re-run the extraction pipeline on the new content, and store fresh references
- When only `title` or `project_id` change: update the document row directly with no thought churn
- At least one optional field must be provided (validation error otherwise)
- Update `write_document` tool description to mention that documents can later be edited via `update_document`

## Non-goals

- Partial/diff-based content updates (content is always a full replacement)
- Version history or change tracking for documents
- Batch updates across multiple documents

## Capabilities

### New Capabilities
- `update-document`: MCP tool for editing existing documents with optional thought re-extraction when content changes

### Modified Capabilities
- `documents` (`openspec/specs/documents/spec.md`): The documents spec gains update semantics — documents are no longer write-once

## Impact

- **Supabase edge function**: New handler in `tools/documents.ts`
- **MCP schema**: New tool registration + updated `write_document` description
- **Thoughts table**: Rows linked to updated documents are deleted and re-created when content changes
- **Extraction pipeline**: Re-used for content updates (no changes to pipeline itself)
