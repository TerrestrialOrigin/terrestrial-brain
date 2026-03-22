## Why

The extractor pipeline (ProjectExtractor, TaskExtractor) and note_snapshots table exist but are not wired into the actual `ingest_note` and `capture_thought` MCP tools. Currently, project detection is done inline via LLM prompts, tasks are never extracted during ingest, and note snapshots are never stored. Sprint 5 integrates all of these into the live ingest flow so that every note ingestion automatically stores a snapshot, extracts tasks, detects projects via the pipeline, and populates the new `metadata.references` format.

## What Changes

- `ingest_note` gains note snapshot upsert (step 2 in SyncChanges Sprint 5.1)
- `ingest_note` gains structural parse + extractor pipeline integration (steps 3-4)
- `ingest_note` populates `note_snapshot_id` and `metadata.references = { projects: [...], tasks: [...] }` on all thoughts
- `capture_thought` gains lightweight structural parse + extractor pipeline (Sprint 5.2)
- `freshIngest()` helper updated to accept and pass through pipeline references and snapshot ID
- Inline project detection in reconciliation and freshIngest prompts is replaced by pipeline results
- New `getProjectRefs()` utility for backwards-compatible reading of both old and new references formats
- Updated return messages to include extraction summary (e.g., "2 tasks detected, 1 project linked")

## Non-goals

- AI Output system (Sprint 6)
- Changes to the Obsidian plugin
- Changes to search_thoughts, list_thoughts, or thought_stats
- Schema migrations (note_snapshots and tasks.reference_id already exist from Sprints 1 and 4)

## Capabilities

### New Capabilities
- `enhanced-ingest`: Integration of note snapshots, structural parser, and extractor pipeline into ingest_note and capture_thought tools

### Modified Capabilities
- `thoughts`: ingest_note and capture_thought now populate note_snapshot_id and metadata.references with new array format; project detection moved from inline LLM to extractor pipeline
- `extractor-pipeline`: Pipeline now wired into live MCP tool invocations (previously standalone)

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` (major changes to ingest_note and capture_thought), `supabase/functions/terrestrial-brain-mcp/helpers.ts` (freshIngest signature change, getProjectRefs utility)
- **Tests:** New `tests/integration/enhanced_ingest.test.ts` for end-to-end ingest pipeline verification
- **APIs:** No new MCP tools; existing tool behavior enhanced with additional data population
- **Dependencies:** Imports parser.ts, pipeline.ts, ProjectExtractor, TaskExtractor into thoughts.ts
