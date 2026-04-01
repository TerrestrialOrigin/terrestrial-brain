## 1. Core Implementation

- [x] 1.1 Register the `update_thought` tool in `tools/thoughts.ts` with Zod input schema: required `id` (string), optional `content` (string), `reliability` (string), `author` (string), `project_ids` (string array), `document_ids` (string array)
- [x] 1.2 Implement validation: at least one optional field must be provided, return `isError: true` otherwise
- [x] 1.3 Implement fetch-existing: query `thoughts` by `id`, return "Thought not found." with `isError: true` if missing
- [x] 1.4 Implement content update path: call `getEmbedding()` + `extractMetadata()` in parallel, merge re-extracted metadata with preserved `source` and updated references, update the row
- [x] 1.5 Implement non-content update path: build update payload for `reliability`, `author`, and reference fields (`project_ids` → `metadata.references.projects`, `document_ids` → `metadata.references.documents`) using replace semantics, update the row without AI calls
- [x] 1.6 Implement confirmation response: return human-readable summary of what was updated

## 2. Testing & Verification

- [x] 2.1 Verify all spec scenarios via manual MCP tool invocation: content update, reliability-only update, author-only update, project_ids replace, document_ids replace, combined content + project_ids, empty fields validation error, nonexistent thought error
- [x] 2.2 Verify embedding failure aborts update (no partial writes)
- [x] 2.3 Verify `created_at` is preserved and `updated_at` is refreshed on all update paths
- [x] 2.4 Run `npx openspec validate "update-thought-mcp"` to confirm implementation matches delta specs
