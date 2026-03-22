## Why

When the AI creates tasks for the user (e.g., "plan the next sprint for CarChief"), two things need to happen atomically: (1) structured task rows are inserted into the `tasks` table with correct project associations, status, and hierarchy, and (2) a markdown document with `- [ ]` checkboxes is written to `ai_output` for delivery to the user's vault. When the plugin delivers that file and the user's next vault sync triggers `ingest_note`, the TaskExtractor must recognize the pre-existing tasks and link to them rather than creating duplicates.

Currently, the AI can create tasks via `create_task` (one at a time) and deliver markdown via `create_ai_output`, but these are disconnected — there's no mechanism to tag task rows with the file path they'll appear in, and no guarantee the TaskExtractor will match them on ingest. Sprint 7 closes this loop.

## What Changes

- **New MCP tool: `create_tasks_with_output`** — accepts a list of tasks (with project, hierarchy, and status) plus a target file path, then: (a) inserts task rows with `reference_id` set to the target `file_path`, (b) generates markdown content with `- [ ]`/`- [x]` checkboxes organized under headings, (c) inserts an `ai_output` row with that markdown at the target path. Returns task IDs + ai_output ID.
- **TaskExtractor deduplication already works** — the existing reconciliation logic matches by `reference_id` + content similarity (>0.8 LCS threshold). Since the new tool tags tasks with `reference_id = file_path`, and `ingest_note` passes the file path as `note_id` (which becomes `ParsedNote.referenceId`), the pipeline query `WHERE reference_id = note.referenceId` will find the pre-created tasks. No changes to TaskExtractor needed.
- **Integration tests** — verify the full round-trip: create tasks + ai_output → simulate ingest of the same content → verify no duplicate tasks, thoughts reference the pre-existing task IDs.

## Non-goals

- No changes to the TaskExtractor reconciliation logic (it already handles this case)
- No changes to the extractor pipeline framework
- No changes to the Obsidian plugin (it already delivers ai_output and triggers ingest)
- No changes to `ingest_note` or `capture_thought`
- No composite query tools (Sprint 8)

## Capabilities

### New Capabilities
- `option4-integration`: MCP tool for atomic task creation + AI output delivery, enabling AI-created tasks to survive the ingest round-trip without duplication

### Modified Capabilities
- `mcp-server`: Tool module table gains `create_tasks_with_output`

## Impact

- **MCP edge function:** `tools/ai_output.ts` gains the new `create_tasks_with_output` tool
- **Plugin unit tests:** New test cases for the round-trip dedup scenario
- **Specs:** New `openspec/specs/option4-integration.md` delta spec
