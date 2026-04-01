## Context

Documents are currently write-once via `write_document`. There is no MCP tool to modify an existing document's title, content, or project assignment. The `documents` table already has an `updated_at` trigger, indicating update support was anticipated at the schema level.

When document content changes, any thoughts that were previously captured from that content become stale. The system already links thoughts to documents via `metadata.references.documents` arrays, so we can identify and clean up stale thoughts.

## Goals / Non-Goals

**Goals:**
- Allow MCP clients to update a document's title, content, and/or project_id
- Automatically clean up stale thoughts when content changes
- Re-extract references from new content using the existing extraction pipeline
- Guide the AI to re-capture thoughts after a content update

**Non-Goals:**
- Partial/diff content edits — content is always a full replacement
- Version history or undo
- Automatic thought re-capture (the tool guides the AI to do this manually via `capture_thought`)
- Batch updates

## Decisions

### 1. Handler placement: same file as other document tools

Add `update_document` in `tools/documents.ts` alongside `write_document`, `get_document`, and `list_documents`. All document tools share the same registration function and Supabase client.

**Alternatives considered:** Separate file — rejected because the existing pattern groups all tools for a resource in one file.

### 2. Thought cleanup strategy: delete-and-re-capture

When content changes, delete all thoughts whose `metadata->'references'->'documents'` array contains the document UUID. The response then instructs the AI to re-capture thoughts from the new content using `capture_thought` with `document_ids`.

**Why not update thoughts in-place?** Thoughts are atomic units extracted from content. Changed content may produce a completely different set of thoughts. Delete + re-capture is simpler and matches the existing `write_document` → `capture_thought` workflow.

**Why not auto-capture thoughts internally?** The existing pattern separates document storage from thought capture — `write_document` returns `thoughts_required: true` and the AI calls `capture_thought` separately. We follow the same pattern for consistency.

### 3. Re-extract references on content change

When content is updated, re-run the extraction pipeline (`parseNote` + `runExtractionPipeline`) on the new content and store fresh references in the document's `references` column. This mirrors the auto-extraction logic in `write_document`.

Title-only or project_id-only updates skip extraction entirely.

### 4. Validation: require at least one update field

Return a validation error if none of `title`, `content`, or `project_id` are provided. This follows the same pattern as `update_person` and `update_task`.

### 5. Verify document exists before updating

Fetch the document first to confirm it exists (and to get the current title for extraction context if needed). Return a clear error if not found, rather than relying on a silent no-op from Supabase's `.update().eq()`.

### Test Strategy

- **Unit tests**: Not applicable — this is a thin MCP handler with no complex logic to isolate.
- **Integration tests**: Test the full `update_document` flow against the real Supabase edge function: update title only, update content (verify thought cleanup + re-extraction), update project_id, validation error on no fields, error on non-existent ID.
- **E2E tests**: Covered by integration tests since the MCP server is the user-facing interface.

## User Error Scenarios

| Error | Handling |
|-------|----------|
| No optional fields provided | Return validation error: "At least one of title, content, or project_id must be provided" |
| Non-existent document ID | Fetch document first; return error: "Document not found" |
| Non-existent project_id | Supabase FK violation → return error message |
| Invalid UUID format | Zod schema validation rejects before handler runs |

## Security Analysis

- **Auth**: Same `x-brain-key` header check as all other MCP tools (handled by middleware)
- **Injection**: Content stored verbatim via parameterized Supabase queries — no SQL injection risk
- **Authorization**: Single-user system with service_role access; no multi-tenant concerns
- **Data loss**: Thought deletion is intentional (stale thoughts) and the response explicitly guides re-capture

## Risks / Trade-offs

- **[Thought loss if AI doesn't re-capture]** → Mitigation: Response text prominently instructs AI to call `capture_thought`. This matches the existing `write_document` pattern which has worked reliably.
- **[Extraction pipeline failure on content update]** → Mitigation: Catch pipeline errors and fall back to empty references (same as `write_document`). Document is still updated; only references may be incomplete.
- **[Orphaned thought cleanup may miss thoughts]** → Mitigation: Query uses `metadata->'references'->'documents' @> '["<uuid>"]'::jsonb` which is the canonical way thoughts reference documents. If a thought was linked differently, it wouldn't have been linked via this system.
