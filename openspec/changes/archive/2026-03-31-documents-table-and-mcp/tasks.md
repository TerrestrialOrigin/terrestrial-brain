## 1. Database Migration

- [x] 1.1 Create migration file `supabase/migrations/20260331000002_documents.sql` with `documents` table, `project_id` FK, indexes, `updated_at` trigger, and RLS policy (service_role full access)

## 2. MCP Tool Implementation — Documents

- [x] 2.1 Create `supabase/functions/terrestrial-brain-mcp/tools/documents.ts` with the `register` export function skeleton and Supabase/Zod/McpServer imports
- [x] 2.2 Implement `write_document` tool: Zod schema (title, content, project_id required; file_path, references optional), insert into `documents`, return id + `thoughts_required: true` with document UUID in response text
- [x] 2.3 Implement reference auto-extraction in `write_document`: when `references` is not provided, call `runExtractionPipeline` with `[ProjectExtractor, PeopleExtractor, TaskExtractor]` (reusing existing pipeline, same as `capture_thought`)
- [x] 2.4 Implement `get_document` tool: accept `id`, return full document row including content
- [x] 2.5 Implement `list_documents` tool: accept optional `project_id` and `limit`, return metadata without content body, resolve project names, order by `created_at` desc

## 3. capture_thought Enhancement

- [x] 3.1 Add `document_ids` optional parameter to `capture_thought` (same pattern as `project_ids`), merge into `metadata.references.documents`
- [x] 3.2 Update `capture_thought` MCP description to mention `document_ids` parameter

## 4. Tool Registration

- [x] 4.1 Import and register documents tools in `supabase/functions/terrestrial-brain-mcp/index.ts`

## 5. Testing & Verification

- [x] 5.1 Write integration tests for `write_document` (with explicit references, without references triggering extraction, FK violation for bad project_id, content stored verbatim)
- [x] 5.2 Write integration tests for `get_document` (existing document, non-existent ID)
- [x] 5.3 Write integration tests for `list_documents` (all documents, filtered by project, empty result)
- [x] 5.4 Write integration test for `capture_thought` with `document_ids` parameter (verify stored in metadata.references.documents)
- [x] 5.5 Run full test suite across all packages and verify 0 failures, 0 skips
- [x] 5.6 Run `npm run build` (or equivalent) and verify the edge function deploys without errors
- [x] 5.7 Fix broken integration test imports by adding root deno.json import map
