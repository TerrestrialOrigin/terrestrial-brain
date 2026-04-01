## 1. Core Implementation

- [x] 1.1 Add `title_contains` and `search` parameters to the `list_documents` Zod input schema in `supabase/functions/terrestrial-brain-mcp/tools/documents.ts`
- [x] 1.2 Add `.ilike()` query builder chains for `title_contains` (on `title` column) and `search` (on `content` column) in the handler
- [x] 1.3 Update the MCP tool `description` string to document the new `title_contains` and `search` parameters

## 2. Testing & Verification

- [x] 2.1 Write integration tests for `list_documents` with `title_contains` filter (substring match, case-insensitivity, no-match returns empty)
- [x] 2.2 Write integration tests for `list_documents` with `search` filter (content substring match, metadata-only response)
- [x] 2.3 Write integration tests for combined filters (`project_id` + `title_contains`, all three filters together)
- [x] 2.4 Verify existing `list_documents` tests still pass (no regression on project_id-only and no-filter cases)
- [x] 2.5 Run full test suite across all packages and verify zero failures, zero skips
