## Why

The MCP tools for browsing and searching thoughts (`list_thoughts`, `search_thoughts`, `thought_stats`) currently lack project awareness. `list_thoughts` supports filtering by type, topic, person, and days — but not by project, even though project references are stored in `metadata.references.projects`. Additionally, `list_thoughts` and `search_thoughts` do not display the `reliability` or `author` columns in their output, which means callers cannot distinguish between reliable (directly captured) thoughts and less-reliable (extraction-pipeline) thoughts, or see which model produced them.

## What Changes

- **Add `project_id` filter to `list_thoughts`**: New optional parameter that filters thoughts by project UUID using JSONB containment on `metadata.references.projects`.
- **Add `project_id` filter to `thought_stats`**: New optional parameter to scope statistics to a single project.
- **Display `reliability` and `author` in `list_thoughts` results**: Each thought in the output includes its reliability level and author model.
- **Display `reliability` and `author` in `search_thoughts` results**: Each thought in the output includes its reliability level and author model.
- **Display project references in result formatting**: Where type, topics, and people are shown, also display linked projects (resolved to project names).
- **Audit all metadata rendering in `thoughts.ts`**: Ensure `references.projects` is treated as a first-class field everywhere that `people` and `topics` already are.

## Non-goals

- Changing how `capture_thought` or `ingest_note` write metadata — those flows already store project references correctly.
- Adding project filtering to `search_thoughts` — semantic search is vector-based; project scoping on search results would require a different approach (post-filter) and is out of scope.
- Changing the `match_thoughts` RPC or any database function signatures.
- Adding new database columns or migrations — `reliability` and `author` columns already exist.

## Capabilities

### New Capabilities

_(none — this change enhances existing capabilities only)_

### Modified Capabilities

- `thoughts` (`openspec/specs/thoughts.md`): `list_thoughts` gains a `project_id` filter parameter. `list_thoughts` and `search_thoughts` output formats change to include `reliability`, `author`, and project references. `thought_stats` gains a `project_id` filter parameter.

## Impact

- **Code**: `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` — modifications to `list_thoughts`, `search_thoughts`, and `thought_stats` tool registrations and handlers.
- **APIs**: MCP tool schemas for `list_thoughts` and `thought_stats` gain a new optional `project_id` parameter. Output format for `list_thoughts` and `search_thoughts` gains new fields. No breaking changes — all additions are optional/additive.
- **Dependencies**: May need to query `projects` table to resolve project UUIDs to names for display. No new npm/deno dependencies.
