## Why

The ingest pipeline currently detects project associations via an inline LLM call embedded in `freshIngest()` (helpers.ts). This approach is tightly coupled, non-extensible, and cannot detect tasks or other entity types. Sprint 3 introduces a formal extractor pipeline framework that decouples entity extraction from ingest, enabling sequential extractors (projects now, tasks in Sprint 4, future entity types later) that share context and produce structured references. This is the prerequisite for Sprints 4–5 which add task extraction and enhanced ingest integration.

## What Changes

- **New extractor interface**: `Extractor`, `ExtractionContext`, and `ExtractionResult` types defining the contract for all entity extractors.
- **New pipeline runner**: `runExtractionPipeline()` function that orchestrates extractors sequentially, passing enriched context from each extractor to the next.
- **New ProjectExtractor**: First concrete extractor — detects project associations from file paths (`/projects/{name}/`), section headings matching known projects, and content mentions via a focused LLM call. Auto-creates project rows for new `/projects/` folders.
- **New extractors directory**: `supabase/functions/terrestrial-brain-mcp/extractors/` houses all pipeline code.

## Non-goals

- Integrating the pipeline into `ingest_note` or `capture_thought` (Sprint 5).
- Building the TaskExtractor (Sprint 4).
- Changing the `thoughts.metadata.references` format (Sprint 5).
- Modifying the Obsidian plugin.

## Capabilities

### New Capabilities
- `extractor-pipeline`: Framework for sequential entity extraction from parsed notes — defines the Extractor interface, ExtractionContext, and pipeline runner.
- `project-extractor`: Detects and auto-creates project associations from file paths, headings, and content mentions.

### Modified Capabilities
- `projects` (`openspec/specs/projects.md`): ProjectExtractor can auto-create project rows when a `/projects/{name}/` folder exists but no matching DB row is found. This adds a new creation path beyond the existing `create_project` MCP tool.

## Impact

- **New files**: `supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts`, `supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts`
- **New test file**: `tests/integration/extractors.test.ts`
- **Dependencies**: Consumes `ParsedNote` from `parser.ts` (Sprint 2). Uses existing Supabase client and OpenRouter LLM for content-based project matching.
- **No database changes**: Uses existing `projects` table as-is.
- **No breaking changes**: Pipeline is additive — existing ingest flow is untouched until Sprint 5.
