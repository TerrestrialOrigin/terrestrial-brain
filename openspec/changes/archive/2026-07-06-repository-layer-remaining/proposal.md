## Why

Step 16 introduced the first two repository seams (`ThoughtRepository`,
`TaskRepository`) but explicitly deferred the remaining entities. Today
`projects`, `people`, `documents`, `ai_output`, and `note_snapshots` are still
reached through ~40 inline `supabase.from(...)` calls scattered across the tool
handlers and extractors (finding X2), and the generic `resolveNames` helper
added in Step 16 is adopted only in `tasks.ts` while four other call sites keep
their hand-copied name-resolution blocks (finding X1). This change completes the
repository refactor: every remaining table goes behind a narrow injected
interface and every name-resolution copy collapses onto the shared helper, so
that after this step **no** database access in `tools/` or `extractors/` bypasses
a repository seam.

## What Changes

- Introduce four new repository interfaces exposing **only** the operations their
  current callers use (no speculative CRUD): `ProjectRepository`,
  `PersonRepository`, `DocumentRepository`, `AiOutputRepository`, plus a
  read-only `QueryRepository` seam covering the composite reads in
  `tools/queries.ts` (`note_snapshots`, and the cross-entity reads that don't
  belong to any single entity repo).
- Implement `SupabaseProjectRepository`, `SupabasePersonRepository`,
  `SupabaseDocumentRepository`, `SupabaseAiOutputRepository`, and
  `SupabaseQueryRepository` — the single home for each table's name, column
  lists, filters, and joins. Each method returns the same narrow `RepoResult<T>`
  (`{ data, error }`) Step 16 established, so handlers keep their existing
  error-surfacing (finding C9) unchanged.
- Move **every** remaining inline `supabase.from(...)` call behind a repository:
  `tools/projects.ts`, `tools/ai_output.ts`, `tools/queries.ts`,
  `tools/documents.ts`, `tools/people.ts`, the `note_snapshots` reads in
  `tools/thoughts.ts`, and the `projects`/`people`/`tasks` reads and writes in
  `extractors/pipeline.ts`, `extractors/people-extractor.ts`, and
  `extractors/project-extractor.ts`.
- Replace the remaining inline name-resolution copies (`queries.ts`,
  `ai_output.ts`, `projects.ts`, `documents.ts`) with the shared `resolveNames`
  helper, and **delete** `resolveProjectNames` from `helpers.ts` (its two callers
  in `thoughts.ts` move to `resolveNames` directly).
- Inject the new repositories as real dependencies: added to each affected tool
  module's `register(...)` signature and threaded from the `index.ts`
  composition root, and placed on `ExtractionContext` where the extractors need
  them (so `PeopleExtractor` / `ProjectExtractor` obtain their seam there instead
  of calling `context.supabase.from`). `runExtractionPipeline` accepts and
  forwards them. No module-level DB singletons — every seam is one a fake can be
  substituted into.

This is a **pure refactor**: zero behavior change is intended. Every call site
keeps its existing control flow, error handling, and output text; only the query
construction moves behind the interface. The Deno integration suite is the
safety net and must stay green **untouched**.

## Non-goals

- **Handler decomposition** (the god-functions in `queries.ts`, `ai_output.ts`,
  `thoughts.ts`) is Step 18 — handlers are rewired to repositories here but not
  split.
- **Generated DB types** (`SupabaseClient<Database>`) are Step 24; the new
  repositories keep hand-written row shapes matching Step 16's convention.
- **Input-validation / `ilike` escaping / affected-row semantics** tightening is
  Step 24; behavior is preserved exactly as-is here.
- **The extractor decompositions** (`ProjectExtractor` / `PeopleExtractor`
  internal restructuring) are Steps 19–20; here only their DB access moves behind
  a seam, their logic is untouched.

## Capabilities

### New Capabilities
- `project-repository`: The `ProjectRepository` seam over the `projects` table —
  its interface contract, the `SupabaseProjectRepository` implementation, and the
  requirement that it be injected (never a module-level singleton).
- `person-repository`: The `PersonRepository` seam over the `people` table — its
  interface contract, implementation, and injection through tool registration and
  `ExtractionContext`.
- `document-repository`: The `DocumentRepository` seam over the `documents` table.
- `ai-output-repository`: The `AiOutputRepository` seam over the `ai_output`
  table, covering the MCP tools and the HTTP AI-output pull API handlers.
- `query-repository`: A read-only seam covering the composite / cross-entity
  reads in `tools/queries.ts` (including the `note_snapshots` reads there), that
  do not belong to any single entity repository.
- `note-snapshot-repository`: The `NoteSnapshotRepository` seam over the
  `note_snapshots` write path in `handleIngestNote` (find-content-by-reference +
  upsert).

### Modified Capabilities
- `extractor-pipeline`: `ExtractionContext` now carries injected
  `projectRepository` and `personRepository`; `runExtractionPipeline` reads its
  known-projects / known-people / known-tasks through the repositories, and
  `ProjectExtractor` / `PeopleExtractor` perform their reads/writes through them
  rather than `context.supabase.from(...)`.

## Impact

- **Code:** new interfaces + implementations under `repositories/`
  (`project-repository.ts`, `supabase-project-repository.ts`;
  `person-repository.ts`, `supabase-person-repository.ts`;
  `document-repository.ts`, `supabase-document-repository.ts`;
  `ai-output-repository.ts`, `supabase-ai-output-repository.ts`;
  `query-repository.ts`, `supabase-query-repository.ts`). Rewired:
  `tools/projects.ts`, `tools/ai_output.ts`, `tools/queries.ts`,
  `tools/documents.ts`, `tools/people.ts`, `tools/thoughts.ts` (`note_snapshots`
  reads + `resolveProjectNames` callers), `helpers.ts` (delete
  `resolveProjectNames`), `extractors/pipeline.ts` (`ExtractionContext` + runner),
  `extractors/people-extractor.ts`, `extractors/project-extractor.ts`, and
  `index.ts` (composition root + HTTP-route context). Each affected
  `register(...)` gains repository parameter(s).
- **Specs:** new `openspec/specs/project-repository/`, `.../person-repository/`,
  `.../document-repository/`, `.../ai-output-repository/`,
  `.../query-repository/`; modified `openspec/specs/extractor-pipeline/`.
- **Tests:** new Deno unit tests proving each new seam (repository implementations
  against a fake Supabase client; at least one handler driven by a fake
  repository, no DB). Existing integration suite unchanged and green.
- **Acceptance gate:** `grep -rn 'supabase.from(' supabase/functions/terrestrial-brain-mcp/tools/ supabase/functions/terrestrial-brain-mcp/extractors/`
  returns nothing.
- **Dependencies / config:** no new deps, no new env vars.
