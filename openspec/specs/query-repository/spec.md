# query-repository Specification

## Purpose
TBD - created by archiving change repository-layer-remaining. Update Purpose after archive.
## Requirements
### Requirement: QueryRepository is the read-only seam for composite queries

The MCP edge function SHALL define a read-only `QueryRepository` interface that
owns every database read performed by `tools/queries.ts` —
`get_project_summary`, `get_recent_activity`, and `get_note_snapshot` — across
the `projects`, `tasks`, `thoughts`, `note_snapshots`, `people`, and `ai_output`
tables. Each method SHALL perform a single query so it remains fake-testable one
query at a time. No code in `tools/queries.ts` SHALL construct a
`supabase.from(...)` query directly; the sole implementation is
`SupabaseQueryRepository`.

#### Scenario: No inline query remains in queries.ts

- **WHEN** `tools/queries.ts` is searched for `supabase.from(`
- **THEN** no match SHALL be found — every read goes through the `QueryRepository`

#### Scenario: Composite reads compose in the handler, not the repository

- **WHEN** `get_project_summary` builds its output
- **THEN** it SHALL call discrete `QueryRepository` read methods (project, children, open tasks, project thoughts, source-note snapshots, assignee names) and compose + format their results in the handler

#### Scenario: Failed sub-query surfaces as unavailable, not empty

- **WHEN** any `QueryRepository` read used by a section of `get_project_summary` / `get_recent_activity` returns an error
- **THEN** the method SHALL return that error in its `RepoResult` so the handler renders the existing "unavailable" marker rather than empty-state prose (finding C9 preserved)

### Requirement: QueryRepository name resolution reuses the shared helper

The `QueryRepository` SHALL resolve ids to display names by delegating to the
shared `resolveNames` free function (project names in `get_recent_activity`,
assignee names in `get_project_summary`) rather than reimplementing the batched
`IN` lookup. `resolveProjectNames` in `helpers.ts` SHALL be deleted and its
`tools/thoughts.ts` callers SHALL call `resolveNames(supabase, "projects", ids)`
directly.

#### Scenario: resolveProjectNames is gone

- **WHEN** the codebase is searched for `resolveProjectNames`
- **THEN** no definition or call SHALL remain — all callers use `resolveNames`

