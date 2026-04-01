## Why

Thoughts are currently immutable once captured via `capture_thought`. There is no way to correct content, change reliability, update author, or re-link a thought to different projects/documents without deleting and recreating it — and deletion is not even exposed via MCP. This makes it impossible to fix typos, reclassify thoughts, or update project associations as the knowledge base evolves.

## What Changes

- Add an `update_thought` MCP tool that accepts a thought UUID and one or more optional fields to update: `content`, `reliability`, `author`, `project_ids`, `document_ids`
- When `content` changes: regenerate the embedding and re-extract metadata (type, topics, people, action_items, dates_mentioned) — same pipeline as `capture_thought`
- When only non-content fields change: update those fields in place without touching the embedding or metadata extraction
- Validate that at least one optional field is provided; return a validation error otherwise
- Preserve original `created_at`; update `updated_at` to reflect the edit time

## Non-goals

- Bulk updating multiple thoughts at once
- Exposing a `delete_thought` tool (separate change if needed)
- Changing the reconciliation/ingest pipeline behavior — this tool is for direct MCP edits only
- Re-running the extractor pipeline (ProjectExtractor, PeopleExtractor, TaskExtractor) on content updates — `update_thought` only re-extracts metadata and regenerates the embedding, matching `capture_thought`'s own behavior for direct captures

## Capabilities

### New Capabilities

- `update-thought`: MCP tool for editing existing thoughts — content updates trigger embedding + metadata regeneration; non-content updates are lightweight in-place patches

### Modified Capabilities

- `thoughts`: The existing thoughts spec gains an `update_thought` scenario section describing the new tool's behavior

## Impact

- **Code**: `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` — new tool registration
- **Specs**: `openspec/specs/thoughts.md` — new scenario section for `update_thought`
- **APIs**: New MCP tool `update_thought` exposed to clients
- **Dependencies**: No new dependencies — reuses existing `getEmbedding()` and `extractMetadata()` from `helpers.ts`
