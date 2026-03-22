## Why

The brain DB now has rich cross-table relationships: thoughts reference projects and tasks, tasks belong to projects, note_snapshots store full source content, and ai_output tracks delivered artifacts. However, there's no way to get a unified picture from any of these axes. To answer "What's going on with CarChief?" the AI must call `get_project`, `list_tasks`, `list_thoughts`, and correlate the results manually. Similarly, "What happened this week?" requires querying each table independently.

Sprint 8 adds two composite query tools that join across tables and return formatted summaries, so the AI can answer these questions in a single tool call.

## What Changes

- **New MCP tool: `get_project_summary`** — given a project UUID, returns a formatted summary including: project details (name, type, description, parent, children), open tasks, recent thoughts referencing this project (last 10), and source notes that mentioned this project (via note_snapshots joined through thoughts).
- **New MCP tool: `get_recent_activity`** — given a number of days (default 7), returns a cross-table activity summary: new/updated thoughts, tasks created or completed, projects created or updated, AI outputs delivered.
- **New tool module: `tools/queries.ts`** — keeps composite query tools separate from CRUD tools for each domain.
- **Registration in `index.ts`** — add `registerQueries(server, supabase)`.
- **Integration tests** — verify both tools return correct cross-table data.

## Non-goals

- No schema changes or migrations
- No changes to existing tools (CRUD tools remain as-is)
- No changes to the extractor pipeline, parser, or Obsidian plugin
- No new AI/LLM calls (these are pure database queries)
- No pagination (acceptable for MVP — thought limit of 10 and default 7-day window keep results bounded)

## Capabilities

### New Capabilities
- `composite-queries`: MCP tools for cross-table summaries that join projects, tasks, thoughts, note_snapshots, and ai_output

### Modified Capabilities
- `mcp-server`: Tool module table gains `get_project_summary` and `get_recent_activity`

## Impact

- **MCP edge function:** New `tools/queries.ts` module, updated `index.ts` registration
- **Integration tests:** New `tests/integration/queries.test.ts`
- **Specs:** New `openspec/specs/composite-queries.md` delta spec
