## Why

TaskExtractor inserts tasks with empty metadata `{}`, missing useful extraction context (source, section heading, how the project was resolved). Additionally, the `due_by` and `assigned_to` columns are never populated during extraction, even though the PeopleExtractor already detects people in the note and dates are often embedded in checkbox text. Tasks extracted from notes should carry the same contextual richness as thoughts.

## What Changes

- **Populate task metadata** on both insert and update paths in TaskExtractor with: `source`, `section_heading`, `extraction_method` (how project_id was resolved: heading_match, file_path, ai_inference, or none).
- **Extract due dates** from checkbox text (e.g., "by Friday", "due 2026-04-01", "before March 30") using a lightweight regex + LLM fallback approach, and populate `due_by`.
- **Integrate PeopleExtractor results with task assignment** — when PeopleExtractor identifies people in the note, use per-checkbox context (mentions of names near/in the checkbox text) to populate `assigned_to` on extracted tasks.

## Non-goals

- Changing the task schema (columns already exist).
- Modifying how thoughts handle metadata (already working).
- Auto-creating new people from checkbox mentions (PeopleExtractor only matches known people, which is correct).
- Changing reconciliation logic (similarity matching is fine as-is).

## Capabilities

### New Capabilities

_(none — all capabilities already exist, just need enrichment)_

### Modified Capabilities

- `task-extractor` (`openspec/specs/task-extractor/spec.md`): Tasks extracted from notes SHALL have populated metadata, due_by (when detectable), and assigned_to (when a known person is mentioned in the checkbox context).

## Impact

- **Code**: `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts` — primary changes (metadata, due_by, assigned_to population). Minor changes to `pipeline.ts` ExtractionContext if needed to pass people references downstream.
- **Dependencies**: No new packages. Uses existing OpenRouter LLM for date/people inference on unresolved cases.
- **Data**: Existing tasks with `metadata: {}` will remain as-is; only newly extracted/updated tasks get enriched. No migration needed.
