# project-repository Specification

## Purpose
TBD - created by archiving change repository-layer-remaining. Update Purpose after archive.
## Requirements
### Requirement: ProjectRepository interface abstracts all projects-table access

The MCP edge function SHALL define a `ProjectRepository` interface as the single
seam over the `projects` table. It SHALL expose only the operations current
callers use — insert (returning the new row's id and name), list-with-filters,
find-by-id, find-parent-name, list-children, collect-descendant-ids (the
recursive archive walk), update, and archive-many-active. No code in `tools/` or
`extractors/` SHALL construct a `supabase.from("projects")` query directly; the
sole implementation is `SupabaseProjectRepository`.

#### Scenario: No inline projects query remains in tools or extractors

- **WHEN** `tools/` and `extractors/` are searched for `from("projects")`
- **THEN** no match SHALL be found — every `projects`-table access goes through the repository

#### Scenario: Auto-create returns the new project identity

- **WHEN** `create_project` or `ProjectExtractor.matchOrCreateProject` inserts a project
- **THEN** the repository's insert method SHALL return the created row's `id` and `name` so context enrichment and success messages are unchanged

#### Scenario: Repository methods carry data and error

- **WHEN** any `ProjectRepository` method completes
- **THEN** it SHALL return a `RepoResult` whose `error` is populated on failure, so handlers keep their existing `if (error)` surfacing

### Requirement: ProjectRepository is injected, never a module-level singleton

`SupabaseProjectRepository` SHALL be constructed once at the `index.ts`
composition root and injected into every consumer — `tools/projects.ts` and
`tools/documents.ts` via `register(...)`, and the extractor pipeline via
`ExtractionContext`. No consumer SHALL read a project repository from a
module-level global.

#### Scenario: Extractor uses the injected repository

- **WHEN** `ProjectExtractor.matchOrCreateProject` auto-creates a project
- **THEN** it SHALL call `context.projectRepository.insert(...)` and SHALL NOT call `context.supabase.from("projects")`

