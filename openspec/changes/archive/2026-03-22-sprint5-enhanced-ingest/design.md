## Context

The extractor pipeline (Sprint 3-4) and note_snapshots table (Sprint 1) are built but not connected to the live ingest path. Currently `ingest_note` uses inline LLM prompts for project detection, doesn't store note snapshots, and doesn't extract tasks. `capture_thought` does no extraction at all. This design wires everything together.

## Goals / Non-Goals

**Goals:**
- Integrate note snapshot upsert into `ingest_note`
- Integrate structural parser + extractor pipeline into both `ingest_note` and `capture_thought`
- Populate `note_snapshot_id` and `metadata.references` (new array format) on all thoughts
- Remove inline project detection from LLM prompts (extractors handle it now)
- Maintain backwards compatibility for old `references.project_id` format

**Non-Goals:**
- AI Output system (Sprint 6)
- Plugin changes
- New MCP tools
- Database migrations (already done)

## Decisions

### 1. Pipeline runs before thought splitting, not per-thought

The extractor pipeline runs once per note, producing a shared `references` map. All thoughts from that note receive the same references. This is correct because project and task associations are note-level, not thought-level.

**Alternative:** Run extractors per-thought after splitting. Rejected because extractors need the full note structure (checkboxes, headings) which individual thoughts don't have.

### 2. Remove project detection from LLM splitting/reconciliation prompts

Currently both `freshIngest()` and the reconciliation prompt include a `projectInstruction` asking the LLM to tag thoughts with project_id. This is replaced by the pipeline's ProjectExtractor results. The LLM prompts are simplified to focus only on splitting/reconciliation.

**Rationale:** Single responsibility — extractors handle entity detection, LLM handles note splitting. Reduces prompt complexity and token usage.

### 3. `freshIngest()` signature extended with optional pipeline results

`freshIngest()` gains optional parameters for `noteSnapshotId` and `references` so ingest_note can pass pipeline results through. When present, every inserted thought gets these values. This avoids duplicating the pipeline call inside freshIngest.

### 4. `getProjectRefs()` helper for backwards compatibility

A standalone utility function reads either `metadata.references.project_id` (old) or `metadata.references.projects` (new array format). Any code reading project references uses this helper.

### 5. Pipeline errors are non-fatal

If the extractor pipeline throws, ingest_note logs the error and continues with empty references. The core ingest flow (thought splitting, embedding, metadata) must not be blocked by pipeline failures.

### 6. `capture_thought` gets lightweight pipeline integration

capture_thought runs the structural parser and pipeline to detect projects/tasks from the content. Since captured thoughts have no note_id, `referenceId` is null and `note_snapshot_id` is null. The pipeline still detects projects from content mentions.

### 7. Test Strategy

- **Integration tests** (`tests/integration/enhanced_ingest.test.ts`): Call actual MCP tools via HTTP against local Supabase, verify DB state
- Tests cover: snapshot storage, task extraction via ingest, references format, re-sync behavior, capture_thought extraction, backwards compat

## Risks / Trade-offs

- **[Performance] Pipeline adds latency to ingest_note** → Acceptable for personal knowledge base (not high-throughput). Pipeline is fast for notes with few checkboxes. The LLM calls in ProjectExtractor and TaskExtractor are the same gpt-4o-mini calls already used.
- **[Correctness] All thoughts get same references** → This is a simplification. A note about both CarChief and Terrestrial Brain will tag all thoughts with both projects. Acceptable — thoughts already reference their source note, and per-thought tagging can be added later if needed.
- **[Error handling] Pipeline failure degrades gracefully** → If extractors fail, thoughts still get ingested with empty references. The user's data is never lost.
