## Why

`list_documents` currently only accepts a `project_id` filter. As the documents table grows, finding a document without knowing its project UUID or exact ID becomes difficult — the only option is to fetch all documents and scan manually. Adding title and content search filters enables efficient document discovery directly through the MCP tool.

## What Changes

- Add a `title_contains` string parameter to `list_documents` for case-insensitive substring matching against document titles (Postgres `ilike`)
- Add a `search` string parameter to `list_documents` for case-insensitive substring matching against document content (Postgres `ilike`)
- Both new filters are combinable with `project_id` and each other using AND logic
- Update the MCP tool description to document the new parameters
- Results continue to return metadata only (no content body), same shape as before

## Non-goals

- Full-text search indexing with `tsvector`/`tsquery` — the `ilike` approach is sufficient for the current document volume and avoids migration complexity
- Adding search to `get_document` — it retrieves by ID and doesn't need filtering
- Returning content snippets or highlights in search results — content stays out of list results
- Pagination or cursor-based navigation — the existing `limit` parameter is sufficient

## Capabilities

### New Capabilities

_(none — this extends an existing capability)_

### Modified Capabilities

- `documents`: The `list_documents` requirement gains two new optional filter parameters (`title_contains`, `search`) that extend the existing listing behavior

## Impact

- **Code**: `supabase/functions/terrestrial-brain-mcp/tools/documents.ts` — the `list_documents` tool registration (input schema, query builder, and description)
- **APIs**: MCP tool `list_documents` gains two new optional parameters (non-breaking, additive change)
- **Dependencies**: None — uses existing Postgres `ilike` operator via Supabase client
- **Specs**: `openspec/specs/documents/spec.md` — the `list_documents` requirement section needs new scenarios
