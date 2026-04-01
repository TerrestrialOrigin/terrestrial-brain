## 1. Core Implementation

- [x] 1.1 Add `update_document` handler in `tools/documents.ts`: register tool with Zod input schema (`id` required, `title`/`content`/`project_id` optional), validate at least one optional field provided, fetch document to verify existence
- [x] 1.2 Implement thought cleanup: when `content` is provided, delete thoughts whose `metadata->'references'->'documents'` contains the document UUID using JSONB containment query
- [x] 1.3 Implement reference re-extraction: when `content` is provided, run `parseNote` + `runExtractionPipeline` on the new content (using new title if provided, else existing title), catch pipeline errors with fallback to empty references
- [x] 1.4 Perform the document update: build update payload from provided fields (including fresh references if content changed), execute Supabase `.update().eq("id", id)`, return confirmation with `thoughts_required: true` when content was updated

## 2. MCP Description Updates

- [x] 2.1 Update `write_document` tool description to mention that existing documents can be edited via `update_document`

## 3. Testing & Verification

- [x] 3.1 Integration test: update title only — verify title changes, updated_at refreshes, no thought deletion
- [x] 3.2 Integration test: update content — verify old thoughts are deleted, new references extracted, response includes `thoughts_required: true`
- [x] 3.3 Integration test: update project_id only — verify project assignment changes
- [x] 3.4 Integration test: no optional fields provided — verify validation error returned
- [x] 3.5 Integration test: non-existent document ID — verify "Document not found" error
- [x] 3.6 Verify `write_document` description now mentions `update_document`
- [x] 3.7 Run full test suite and validate build
