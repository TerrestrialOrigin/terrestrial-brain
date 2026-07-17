## Why

"Every list has an explicit limit" is violated in several tool-reachable paths, so after a year of ingests a single call can pull an entire table into the edge function's memory and the MCP response. `list_projects`/`list_people` accept no limit and their repositories issue no `.limit()`; seven of the eight `get_recent_activity` sub-queries are unbounded (only `listRecentThoughts` is capped); `reconcile_tasks` hardcodes `limit: 100` with no truncation detection; `listPending` returns every pending row including full content; and `get_pending_ai_output_metadata` (RPC) has no `LIMIT` — its only bound is PostgREST's **silent** 1000-row truncation, so newer pending items appear to vanish.

## What Changes

- Add `limit` to `PersonListFilters` and `ProjectListFilters`; apply a `limit + 1` truncation probe; give `list_people`/`list_projects` a zod-bounded `limit` input (default `DEFAULT_LIST_LIMIT`, max `MAX_QUERY_LIMIT`) and render an explicit truncation notice.
- Cap every unbounded `*Since` query and `listOpenTasksForProject` and `listPending` at a named section limit with a `limit + 1` probe; `get_recent_activity` renders `## Section (50+)`-style explicit truncation; give its `days` param a schema maximum.
- `listActive` (person/project extractor seed) gets an explicit high cap with logged truncation instead of a silent full scan.
- `reconcile_tasks` gets the `limit + 1` probe and appends a "more exist — narrow by project" note when capped.
- New append-only migration: recreate `get_pending_ai_output_metadata(max_rows integer default 200)` with `LIMIT greatest(max_rows, 1)`; restate revoke/grant. The edge repository passes the limit and logs when exactly `max_rows` rows return (possible truncation).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `projects`: `list_projects` SHALL accept a bounded `limit` and report truncation.
- `people`: `list_people` SHALL accept a bounded `limit` and report truncation.
- `composite-queries`: `get_recent_activity` SHALL bound every section query and report per-section truncation; `days` SHALL have a schema maximum.
- `ai-output`: `get_pending_ai_output_metadata` and `listPending` SHALL be bounded and truncation SHALL be explicit/logged, never silent.
- `memory-lifecycle-rules`: `reconcile_tasks` SHALL bound its task set and report truncation.

## Non-goals

- The god-interface split (Step 27) or other structural refactors.
- Changing the extractor `listActive` seed's semantics beyond adding an explicit cap + truncation log.

## Impact

- `constants.ts`; `repositories/{person,project,query,ai-output}-repository.ts` + Supabase impls; `tools/{projects,people,queries,tasks}.ts`; one new migration; the ai-output repository RPC caller.
- Affected spec files: `openspec/specs/projects.md`, `openspec/specs/people/spec.md`, `openspec/specs/composite-queries.md`, `openspec/specs/ai-output/spec.md`, `openspec/specs/memory-lifecycle-rules/spec.md`.
