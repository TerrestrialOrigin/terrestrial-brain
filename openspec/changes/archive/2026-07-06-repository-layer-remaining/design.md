## Context

Step 16 established the repository pattern (`ThoughtRepository`,
`TaskRepository`, the shared `resolveNames` helper, the `RepoResult<T>` envelope,
a `fake-supabase-client.ts` for unit tests) and moved the `thoughts`/`tasks`
access behind it. Step 17 completes the seam: every remaining table
(`projects`, `people`, `documents`, `ai_output`, `note_snapshots`) and every
composite read in `queries.ts` moves behind an injected interface, and the four
remaining inline name-resolution copies collapse onto `resolveNames`.

Remaining DB touch-points by file (from `grep supabase.from(` / `.rpc(`):

- **`tools/projects.ts`** — `create_project` (insert), `list_projects` (select +
  filters, parent-name lookup, child-count lookup), `get_project` (select single,
  parent lookup, children lookup, **open-task count**), `update_project`
  (update), `archive_project` (select name, recursive descendant walk, batch
  archive, **open-task fetch + batch archive**).
- **`tools/people.ts`** — `create_person` (insert), `list_people` (select +
  filters), `get_person` (select single, **open-task-assigned count**),
  `update_person` (update), `archive_person` (select name, update).
- **`tools/documents.ts`** — `write_document` (insert), `get_document` (select
  single, project-name lookup), `list_documents` (select + filters + ilike,
  project-name lookup), `update_document` (select single, update, **thought
  archive-by-document-reference**).
- **`tools/ai_output.ts`** — the five HTTP handlers (`ai_output` select/update +
  `get_pending_ai_output_metadata` RPC), `create_ai_output` (insert),
  `create_tasks_with_output` (project/person name lookups, **task insert**,
  **task rollback-delete**, `ai_output` insert).
- **`tools/queries.ts`** — `get_project_summary` and `get_recent_activity` read
  across `projects`, `tasks`, `thoughts`, `note_snapshots`, `people`,
  `ai_output`; `get_note_snapshot` reads `note_snapshots`.
- **`tools/thoughts.ts`** — `handleIngestNote` reads/upserts `note_snapshots`;
  `search_thoughts`/`list_thoughts` call `resolveProjectNames`.
- **`extractors/pipeline.ts`** — runner reads active `projects`, active `people`,
  and `tasks`-by-reference for context seeding.
- **`extractors/people-extractor.ts`** / **`project-extractor.ts`** —
  auto-create insert into `people` / `projects`.

## Goals / Non-Goals

**Goals**
- Injected, fakeable seams over every remaining table; **zero** `supabase.from(`
  left in `tools/` or `extractors/`.
- The four inline name-resolution copies replaced by `resolveNames`;
  `resolveProjectNames` deleted.
- Zero behavior change; integration suite untouched and green.
- Unit tests proving each new seam (impl against the fake client; ≥1 handler
  driven by a fake repo).

**Non-Goals** (deferred)
- Handler decomposition (god-functions) → Step 18. Generated DB types → Step 24.
- `ilike` escaping, enum/uuid validation, affected-row semantics → Step 24
  (behavior preserved as-is here).
- Extractor internal restructuring → Steps 19–20 (only their DB access moves).

## Decisions

### D1: A read-only `QueryRepository` owns every read in `queries.ts`; entity repos own their own tool file's CRUD
`queries.ts` is a composite read surface hitting six tables with one-off shapes
(`thoughts.contains(metadata …)`, "recent since date" projections,
created-vs-updated dedup inputs). Rather than bloat every entity repository with
projections only `queries.ts` uses, all of its reads move into a single
read-only `QueryRepository` (methods: `getProjectById`, `getProjectName`,
`listChildProjects`, `listOpenTasksForProject`, `listProjectThoughts`,
`getNoteSnapshotsByIds`, `resolvePersonNames`, `listRecentThoughts`,
`listTasksCreatedSince`, `listTasksCompletedSince`, `listProjectsCreatedSince`,
`listProjectsUpdatedSince`, `listPeopleCreatedSince`, `listPeopleUpdatedSince`,
`listDeliveredAiOutputsSince`, `getNoteSnapshot`). `queries.ts` becomes pure
orchestration + formatting.

**Key point:** the grep acceptance gate targets `tools/` and `extractors/` only —
`repositories/*.ts` is *where* `supabase.from(` is allowed to live. So
`SupabaseQueryRepository` may issue its `supabase.from(...)` calls directly; that
is the seam, not a violation. *Alternative considered:* inject six entity repos
into `queries.ts` and orchestrate. Rejected: a 6-dependency register signature
and forcing entity repos to grow query-only projections is worse than one
cohesive read facade. Entity repos stay focused on the CRUD their own tool uses.

### D2: New entity repositories — `Project`, `Person`, `Document`, `AiOutput`
Each mirrors Step 16's shape exactly: an interface file (`*-repository.ts`) with
hand-written row types and only the methods its tool file calls, plus a
`Supabase*Repository` implementation returning `RepoResult<T>`. Method inventory
(minimal, one caller each):
- `ProjectRepository`: `insert`, `list(filters)`, `findById`, `findParentName`,
  `listChildren`, `listChildrenBasic` (id+name+type for get_project),
  `collectDescendantIds` (the recursive archive walk), `update`,
  `archiveManyActive(ids)`.
- `PersonRepository`: `insert`, `list(filters)`, `findById`, `findName`,
  `update`, `archive`.
- `DocumentRepository`: `insert`, `findById`, `list(filters)`, `findForUpdate`,
  `update`.
- `AiOutputRepository`: `insert`, `listPending`, `listPendingMetadata` (RPC),
  `findContentByIds`, `markPickedUp`, `reject`.

### D3: A small `NoteSnapshotRepository` for `handleIngestNote`
`note_snapshots` is written only in `handleIngestNote` (find-content-by-reference
+ upsert). Those two ops go behind `NoteSnapshotRepository`
(`findContentByReference`, `upsert`). Its *reads* used by `queries.ts`
(`getNoteSnapshotsByIds`, `getNoteSnapshot`) live on the `QueryRepository` per D1,
so the two consumers stay decoupled. The shared `fake-supabase-client.ts` gains an
`upsert` builder method to test the upsert path.

### D4: Extend `TaskRepository` / `ThoughtRepository` for cross-file task/thought ops
Some task/thought access lives in *other* tools' files. Rather than let those
files keep raw `supabase.from`, extend the Step-16 repos with the missing methods
(each still one caller): `TaskRepository` gains `countOpenByProject`,
`countOpenByAssignee`, `findOpenIdsByProjects`, `archiveMany`, `deleteByIds`,
`findByReference` (pipeline context seed); `ThoughtRepository` gains
`archiveByDocumentReference`. This keeps all `tasks`/`thoughts` access in the two
repositories that already own those tables, rather than duplicating it into a
projects/documents repo.

### D5: `resolveNames` adoption; delete `resolveProjectNames`
The four inline copies (`create_tasks_with_output` project + person lookups,
`get_project_summary` assignee lookup, `get_recent_activity` project lookup,
`get_document`/`list_documents` project lookups) become `resolveNames(supabase,
table, ids)` calls (returning `Map`, `.get(id) || id` at the callsite, exactly the
existing raw-id fallback semantics). `resolveProjectNames` in `helpers.ts` is
**deleted**; its two callers in `thoughts.ts` already do `map.get(uuid) || uuid`,
so they switch to `resolveNames(supabase, "projects", uuids)` with identical
output. Where the reads move into `QueryRepository` (queries.ts), the resolver is
a `resolvePersonNames`/`resolveProjectNames` **method** on that repo delegating to
the same shared free function — no second implementation.

### D6: Extractor injection — `ExtractionContext` gains `projectRepository` + `personRepository`
`ProjectExtractor.matchOrCreateProject` and `PeopleExtractor.createPerson` switch
from `context.supabase.from(...).insert(...)` to
`context.projectRepository.insert(...)` / `context.personRepository.insert(...)`.
`runExtractionPipeline` gains both repos as parameters (alongside the existing
`taskRepository`), seeds `knownProjects`/`knownPeople` through
`projectRepository.listActive()` / `personRepository.listActive()` and
`knownTasks` through `taskRepository.findByReference(...)`. Both `documents.ts`
call sites and both `thoughts.ts` call sites of `runExtractionPipeline` forward
the new repos; `register(...)` for `thoughts.ts` and `documents.ts` gains the two
parameters, wired from `index.ts`.

### D7: Everything returns `RepoResult<T>`; no throwing (Step 16 D1 carried forward)
Identical rationale: a pure refactor keeps each handler's `if (error)` branch
line-for-line. "Not found" single-row lookups return `{data:null,error:null}`
(preserving `PGRST116` friendly-message branches via the `RepoError.code` already
on `RepoResult`).

### D8: Injection surface (composition root)
`index.ts` constructs one instance of each new repository over the shared client
and injects them: `registerProjects(+projectRepository, +taskRepository)`,
`registerPeople(+personRepository, +taskRepository)`,
`registerDocuments(+documentRepository, +projectRepository)` (already has
aiProvider+taskRepository), `registerAIOutput(+aiOutputRepository,
+projectRepository?, +taskRepository)` — actually `create_tasks_with_output` uses
`resolveNames` for project/person names + `taskRepository` for task
insert/rollback, and `aiOutputRepository` for the output insert; the five HTTP
handlers take `aiOutputRepository` (threaded via `HttpRouteContext`),
`registerQueries(+queryRepository)`, `registerThoughts(+noteSnapshotRepository)`.
Stateless wrappers over one client → one instance each, shared across requests
(same as Step 16). No module-level singletons.

## User Error / Edge Scenarios
- **LLM-hallucinated project/person id in a lookup** → `resolveNames` returns a
  map missing that id; `.get(id) || id` renders the raw id (unchanged).
- **Name-resolution DB error** → `resolveNames` logs + raw-id fallback map
  (finding C9, unchanged).
- **Single-row not-found** (`get_document`, `get_project`, `get_note_snapshot`)
  → repo returns `{data:null, error:null}` (or the `PGRST116` code preserved) →
  friendly not-found text, not a thrown error.
- **`create_tasks_with_output` mid-loop insert failure** → the existing rollback
  (delete already-inserted ids) runs through `taskRepository.deleteByIds`; the
  all-or-nothing guarantee (finding C4) is preserved exactly.
- **`update_document` update fails** → thoughts are left untouched (repo call for
  the archive is only reached after a successful update — ordering preserved).

## Security Analysis
No new external input surface, endpoints, or auth changes. Existing filters move
behind interfaces unchanged, so RLS and the service-role boundary are unaffected.
`resolveNames` and every new repo method use parameterized `.in(...)` / `.eq(...)`
(no string interpolation). The `ilike` wildcard escaping (`list_documents`) is
explicitly Step 24 and is neither added nor regressed here. No `ThreatModel.md`
delta is warranted for a behavior-neutral internal refactor.

## Test Strategy
- **Unit (new, `tests/unit/`)** — one `*-repository.test.ts` per new repo
  (`project`, `person`, `document`, `ai-output`, `note-snapshot`, `query`)
  against the fake client, asserting each method builds the right
  table/columns/filters and maps results; `resolveNames` already covered. GATE
  2b: deleting a method body reddens its test. At least one handler-level test
  driving a rewired handler with a fake repo (extend the existing
  `list-tasks-handler` pattern if a clean seam exists).
- **Integration (existing, `tests/integration/`)** — the full Deno suite is the
  behavior safety net and MUST pass **unmodified**. If any integration test needs
  editing, that signals a behavior change — investigate, don't edit.
- **Plugin suite** — untouched; run for GATE 4 completeness.

## Risks / Trade-offs
- [A broad mechanical rewire across ~10 files drops a filter/column/order] →
  Move one method at a time; lean on the untouched integration suite; the final
  grep gate proves no raw access slipped through.
- [`QueryRepository` is large (~16 read methods)] → Accepted: it is a cohesive
  read facade for one tool file, each method a single query (keeps it
  fake-testable one query at a time). Splitting it is deferred with the handler
  decomposition (Step 18).
- [Extending two Step-16 interfaces re-touches `tasks`/`thoughts` repos] →
  Additive only (new methods); existing methods and their tests are unchanged.

## Migration Plan
Pure code refactor: no DB migration, no config, no new env vars. Deploys as a
normal edge-function update. Rollback = revert the branch; no data/schema touched.

## Open Questions
None blocking.
