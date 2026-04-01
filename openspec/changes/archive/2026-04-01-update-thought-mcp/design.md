## Context

Thoughts in Terrestrial Brain are currently write-once via `capture_thought` (MCP) or `ingest_note` (Obsidian plugin). Once captured, there is no MCP tool to correct content, reclassify, or update project/document associations. The only mutation path is the Obsidian reconciliation flow, which is tightly coupled to note ingestion.

The `update_document` tool (recently added) provides a reference pattern: fetch-existing → validate → conditionally re-extract → update in place. `update_thought` follows the same shape but is simpler because thoughts are single rows (no linked child thoughts to clean up).

## Goals / Non-Goals

**Goals:**

- Allow MCP clients to update any mutable field on an existing thought
- Regenerate embedding + metadata when content changes (consistency with `capture_thought`)
- Keep non-content updates lightweight (no AI calls)
- Follow established patterns from `update_document` and `capture_thought`

**Non-Goals:**

- Bulk update of multiple thoughts
- Exposing delete_thought via MCP
- Re-running the extractor pipeline on content updates (capture_thought does not run extractors for direct captures in a way that would change the thought's references — the pipeline runs but references are stored as-is; for update_thought, we match the same approach: re-extract metadata + embedding, merge explicit reference overrides)
- Changing how Obsidian reconciliation works

## Decisions

### 1. Two update paths: content vs. non-content

**Decision:** When `content` changes, regenerate embedding and re-extract metadata via the same `getEmbedding()` + `extractMetadata()` calls used in `capture_thought`. When only non-content fields change (`reliability`, `author`, `project_ids`, `document_ids`), perform a direct DB update with no AI calls.

**Why over single path:** Embedding generation and metadata extraction are expensive (two OpenRouter calls). Updating just reliability or project links should be instant. This mirrors how `capture_thought` separates "content processing" from "field storage."

### 2. Reference updates replace rather than merge

**Decision:** When `project_ids` or `document_ids` are provided, they fully replace the corresponding arrays in `metadata.references`. This differs from `capture_thought` which merges explicit IDs with pipeline-detected IDs.

**Why:** `update_thought` is an explicit correction tool. If a user says "this thought should be linked to projects A and B", they mean exactly A and B — not "add A and B to whatever was there before." This matches `update_document`'s behavior where content replacement is total, not additive. The caller can read the existing thought first if they want to preserve + extend.

**Alternative considered:** Merge mode (union with existing). Rejected because it makes it impossible to remove a project link without a separate "remove_project_from_thought" tool.

### 3. Content update preserves source and reference_id

**Decision:** When content is updated, `metadata.source` and `reference_id` are NOT changed. The thought retains its original provenance. Only `content`, `embedding`, and the extracted metadata fields (`type`, `topics`, `people`, `action_items`, `dates_mentioned`) are overwritten.

**Why:** A thought's source ("mcp" vs "obsidian") and vault link (`reference_id`) describe where it came from, not what it currently says. Changing content doesn't change origin.

### 4. No extractor pipeline on content update

**Decision:** `update_thought` does NOT run the full extractor pipeline (ProjectExtractor, PeopleExtractor, TaskExtractor) when content changes. It only runs `getEmbedding()` + `extractMetadata()`.

**Why:** The extractor pipeline creates/modifies external entities (auto-creates projects, people, tasks). An edit to an existing thought should not trigger side effects like new project or person creation. The caller can explicitly set `project_ids` if project associations need to change. This keeps updates predictable and side-effect-free.

### 5. Metadata field merging strategy

**Decision:** When content changes, the re-extracted metadata fields (`type`, `topics`, `people`, `action_items`, `dates_mentioned`) overwrite the existing values. But `source`, `references`, and any other existing metadata keys are preserved via spread: `{ ...existingMetadata, ...newExtractedMetadata, source: existingSource, references: updatedReferences }`.

**Why:** Metadata extraction is content-dependent, so it must be refreshed. But structural metadata (source, references) is independent of content text.

### Test Strategy

- **Unit tests:** Not applicable — this is a Supabase Edge Function with no local test harness. Validation logic is minimal (one "at least one field" check).
- **Integration/E2E:** Manual MCP tool invocation against a running Supabase instance. The delta specs define the acceptance scenarios.
- **Key scenarios to verify:** content update triggers re-embedding, non-content update skips AI calls, validation rejects empty updates, nonexistent thought returns error.

## Risks / Trade-offs

- **[Stale embedding after partial metadata update]** → If a user updates `reliability` without updating `content`, the embedding stays consistent with the content. No risk here — only content changes affect embedding relevance.
- **[Race condition with Obsidian reconciliation]** → If a user updates a thought via MCP while Obsidian reconciliation is running on the same thought, the reconciliation could overwrite the MCP edit. → Mitigation: This is a single-user system; concurrent edits are extremely unlikely. No locking needed.
- **[Replace semantics for references may surprise callers]** → A caller providing `project_ids: []` will clear all project links. → Mitigation: Clear documentation in the tool description. This is intentional — it's the only way to unlink a thought from all projects.
