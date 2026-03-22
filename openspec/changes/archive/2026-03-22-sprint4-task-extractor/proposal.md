## Why

The extractor pipeline (Sprint 3) currently only extracts project associations. Notes contain task checkboxes (`- [ ]` / `- [x]`) that represent actionable work items, but these are not captured in the `tasks` table. Users organize tasks under project headings and in project folders — the pipeline needs a TaskExtractor that converts parsed checkboxes into structured task rows with project associations and subtask hierarchy.

Without this, the brain DB has no awareness of tasks written in Obsidian notes, and the future enhanced ingest (Sprint 5) cannot populate `thoughts.metadata.references.tasks`.

## What Changes

- **Database migration:** Add `reference_id` column to `tasks` table so tasks can be traced back to their source note (vault-relative path). Required for reconciliation on re-ingest.
- **New TaskExtractor:** Second concrete extractor implementing the `Extractor` interface. Converts `ParsedNote.checkboxes` into task rows with:
  - Project association via priority chain (file path > section heading > AI content inference)
  - Subtask hierarchy from checkbox indentation (`parent_id`)
  - Reconciliation against existing tasks on re-ingest (match by `reference_id` + content similarity)
  - Status tracking (`- [ ]` = open, `- [x]` = done)
- **Pipeline context update:** `runExtractionPipeline()` populates `knownTasks` for the note's `reference_id` so TaskExtractor can reconcile.

## Non-goals

- Integrating the pipeline into `ingest_note` or `capture_thought` (Sprint 5).
- Changing the `thoughts.metadata.references` format (Sprint 5).
- Deleting tasks when checkboxes are removed from a note (tasks persist — they may have been moved).
- Modifying the Obsidian plugin.

## Capabilities

### New Capabilities
- `task-extractor`: Detects tasks from note checkboxes, associates with projects, reconciles on re-ingest, and manages subtask hierarchy.

### Modified Capabilities
- `tasks` (`openspec/specs/tasks.md`): Tasks can now be created via two paths — the existing `create_task` MCP tool and auto-extraction by the TaskExtractor from note checkboxes.
- `extractor-pipeline` (`openspec/specs/extractor-pipeline.md`): Pipeline context initialization now populates `knownTasks` filtered by the note's `reference_id`.

## Impact

- **New file:** `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts`
- **New migration:** `supabase/migrations/YYYYMMDD_tasks_reference_id.sql` — adds `reference_id` column to tasks
- **Modified file:** `supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts` — populate `knownTasks` in context
- **Modified test file:** `tests/integration/extractors.test.ts` — new TaskExtractor tests
- **Dependencies:** Consumes `ParsedNote.checkboxes` from `parser.ts` (Sprint 2). Reads `context.knownProjects` and `context.newlyCreatedProjects` from ProjectExtractor (Sprint 3). Uses existing Supabase client and OpenRouter LLM for content-based project matching.
- **No breaking changes:** TaskExtractor is additive — existing task MCP tools and ingest flow are untouched.
