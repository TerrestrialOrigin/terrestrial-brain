## Why

The MCP edge function has no seam over supabase-js: ~50 inline
`supabase.from(...)` / `supabase.rpc(...)` calls are scattered directly through
the tool handlers and extractors (finding X2). Nothing that touches the database
can be unit-tested without a live DB, table names and column lists are
copy-pasted across handlers, and the name-resolution query (id → human name) is
re-implemented inline four times in `tasks.ts` alone. This change introduces the
first two repository seams — for the two highest-traffic tables, `thoughts` and
`tasks` — following the exact injection pattern the `AiProvider` seam
established in Step 15. It is the foundational half of the repository refactor;
the remaining entities follow in Step 17.

## What Changes

- Introduce a `ThoughtRepository` interface and a `TaskRepository` interface,
  each exposing **only** the operations their current callers use (no
  speculative CRUD): create / list / find-by-id(s) / update / archive /
  vector-match / usefulness-increment / stats reads for thoughts; create / list /
  find-by-ids / update / archive for tasks.
- Implement `SupabaseThoughtRepository` and `SupabaseTaskRepository` — the single
  home for every `thoughts`/`tasks` table name, column list, filter, and RPC
  call. Each repository method returns a narrow `RepoResult<T>` (`{ data, error }`)
  so handlers keep their existing error-surfacing (finding C9) unchanged.
- Move **every** inline `supabase.from("thoughts")` / `supabase.from("tasks")`
  call in `tools/thoughts.ts`, `tools/tasks.ts`, `helpers.ts`, and
  `extractors/task-extractor.ts` behind these repositories, plus the two
  thoughts-related RPCs (`match_thoughts`, `increment_usefulness`).
- Add a generic, shared `resolveNames(supabase, table, ids, nameColumn?)`
  helper returning `Map<string, string>` (id → name, raw-id fallback on lookup
  error). Replace the four inline name-resolution copies in `tasks.ts`
  (`list_tasks` and `get_tasks` project/person/parent lookups) with it, and make
  the existing `resolveProjectNames` a thin delegate to it.
- Inject both repositories as real dependencies: added to each affected tool
  module's `register(...)` signature and threaded from the `index.ts`
  composition root; `TaskRepository` is placed on `ExtractionContext` (so
  `TaskExtractor` obtains it there instead of calling `context.supabase.from`),
  and `runExtractionPipeline` accepts and forwards it. No module-level DB
  singletons — this is a seam a fake can be substituted into.

This is a **pure refactor**: zero behavior change is intended. Every call site
keeps its existing control flow, error handling, and output text; only the query
construction moves behind the interface. The Deno integration suite is the
safety net and must stay green **untouched**.

## Non-goals

- **Remaining entities** — `projects`, `people`, `documents`, `ai_output`, and
  the read-only `queries.ts` seam — are Step 17 and explicitly out of scope. Only
  `thoughts` and `tasks` move here.
- **`note_snapshots` access** in `handleIngestNote` stays as raw `supabase.from`
  for now (it is neither the `thoughts` nor `tasks` table); a later step handles
  it. `handleIngestNote` therefore still receives `supabase` alongside the
  repositories.
- **The remaining `resolveNames` call sites** in `queries.ts`, `ai_output.ts`,
  `projects.ts`, and `documents.ts`, and the deletion of `resolveProjectNames`,
  are Step 17. This change only introduces `resolveNames` and adopts it in
  `tasks.ts`.
- **Handler decomposition** (the god-functions) is Step 18 — handlers are rewired
  to repositories here but not split.
- **Generated DB types** (`SupabaseClient<Database>`) are Step 24; repositories
  keep their hand-written row shapes for now.

## Capabilities

### New Capabilities
- `thought-repository`: The `ThoughtRepository` seam over the `thoughts` table
  and its two RPCs — its interface contract, the `SupabaseThoughtRepository`
  implementation, and the requirement that it be injected (never a module-level
  singleton) so a fake can be substituted in tests.
- `task-repository`: The `TaskRepository` seam over the `tasks` table — its
  interface contract, the `SupabaseTaskRepository` implementation, injection
  through tool registration and `ExtractionContext`, and the shared generic
  `resolveNames` name-resolution helper.

### Modified Capabilities
- `extractor-pipeline`: `ExtractionContext` now carries an injected
  `taskRepository`; `TaskExtractor` performs its task reads/writes through it
  rather than `context.supabase.from("tasks")`. `runExtractionPipeline` accepts
  and forwards the repository.

## Impact

- **Code:** new `repositories/` module (`thought-repository.ts` interface +
  `supabase-thought-repository.ts` impl; `task-repository.ts` interface +
  `supabase-task-repository.ts` impl; `name-resolution.ts` shared helper; a
  `RepoResult` type). Rewired: `tools/thoughts.ts` (incl. `handleIngestNote`),
  `tools/tasks.ts`, `tools/documents.ts` (forwards `taskRepository` to the
  pipeline only), `helpers.ts` (`freshIngest`, `resolveProjectNames`),
  `extractors/pipeline.ts` (`ExtractionContext` + runner signature),
  `extractors/task-extractor.ts`, and `index.ts` (composition root + HTTP-route
  context). Each affected `register(...)` gains repository parameter(s).
- **Specs:** new `openspec/specs/thought-repository/`, `.../task-repository/`;
  modified `openspec/specs/extractor-pipeline/`.
- **Tests:** new Deno unit tests proving the seam — repository implementations
  against a fake Supabase client, `resolveNames`, and at least one tool handler
  driven by a fake repository (no DB). Existing integration suite unchanged and
  green.
- **Dependencies / config:** no new deps, no new env vars.
