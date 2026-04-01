## Context

`capture_thought` is the MCP tool that lets AI callers store a thought directly in the knowledge base. It already stores content verbatim — the cheap AI (gpt-4o-mini) only handles metadata extraction, never modifying the content itself. However, it currently lacks provenance fields: there's no way to know which AI authored a thought or to distinguish a directly-authored thought from one extracted by the ingest pipeline.

The `reliability` and `author` columns were added to the thoughts table in the previous change (`20260331000001_thoughts_reliability_author.sql`), but `capture_thought` doesn't populate them yet.

Additionally, the extraction pipeline's project detection is best-effort — if the caller already knows the relevant project UUIDs, there's no way to pass them explicitly.

## Goals / Non-Goals

**Goals:**
- Populate `reliability` and `author` on every thought created via `capture_thought`
- Allow callers to pass explicit `project_ids` that merge with pipeline-detected projects
- Update the MCP description to clearly position this as the AI-caller function

**Non-Goals:**
- Making `reliability` caller-configurable (always `'reliable'`)
- Changing content handling (still byte-for-byte verbatim)
- Creating a separate `record_thought_verbatim` function (unnecessary — `capture_thought` already does this)
- Adding `author`/`reliability` to `list_thoughts` or `search_thoughts` output formatting (separate change)

## Decisions

### 1. Hardcode reliability to 'reliable'

All thoughts from `capture_thought` are authored directly by the calling AI, not extracted/paraphrased by a secondary model. They are inherently more reliable than ingest pipeline thoughts. Hardcoding avoids callers accidentally setting the wrong value.

**Alternative considered:** Making it an optional parameter with default `'reliable'`. Rejected because there's no valid use case for a direct AI caller to mark its own thought as unreliable.

### 2. Merge project_ids with pipeline results (union, not replace)

When the caller passes `project_ids`, those UUIDs are unioned with whatever the `ProjectExtractor` found in the content. This means the pipeline can still detect projects from content that the caller didn't explicitly link, and the caller can link projects that aren't mentioned in the content text.

**Alternative considered:** Replace pipeline results with explicit IDs when provided. Rejected because it would silently drop pipeline detections.

### 3. author is optional, not required

Some callers may not know or care to pass their model identifier. Making it optional keeps backward compatibility and doesn't break existing integrations.

### Test Strategy

- **Integration tests**: Test that `capture_thought` with `author` and `project_ids` produces a row with the correct `reliability`, `author`, and merged `metadata.references.projects`. Test that omitting optional fields still works and `reliability` is always set.

## Risks / Trade-offs

- **[Risk] Caller passes invalid project UUIDs** -> The insert will succeed (no FK constraint on the jsonb references field). This is consistent with how the pipeline already works — it stores UUIDs without FK validation. A future cleanup job could detect orphaned references.
- **[Risk] Backfill gap** -> Existing `capture_thought` rows have `reliability = NULL` and `author = NULL`. The previous migration backfilled all existing rows to `'less reliable'` / `'gpt-4o-mini'`, which is incorrect for thoughts that were directly captured via MCP. However, there's no reliable way to distinguish them retroactively since `metadata.source = 'mcp'` was set for direct captures. A targeted backfill could update rows where `metadata->>'source' = 'mcp'` to `reliability = 'reliable', author = NULL`, but this is out of scope for this change.
