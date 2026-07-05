## Context

The MCP edge function (`supabase/functions/terrestrial-brain-mcp/`) reaches
supabase-js directly from every tool handler and from `TaskExtractor`. Step 15
already proved the injection pattern this change copies: a narrow interface in a
dedicated module, a single concrete implementation, a factory at the composition
root, and the dependency threaded through `register(...)` and
`ExtractionContext` — never a module-level singleton. This change applies that
pattern to the two highest-traffic tables, `thoughts` and `tasks`.

Current DB touch-points in the four in-scope files:

- **`tools/thoughts.ts`** — `search_thoughts` (`rpc match_thoughts`),
  `list_thoughts` (select + metadata filters), `thought_stats` (count-head +
  metadata read), `get_thought_by_id` (select single + `rpc increment_usefulness`),
  `capture_thought` (insert + `rpc increment_usefulness`), `update_thought`
  (select single + update, two branches), `record_useful_thoughts`
  (`rpc increment_usefulness`), `archive_thought` (select-active + update), and
  `handleIngestNote` (find-by-reference + update/insert/archive in the
  reconciliation plan; plus `note_snapshots` reads/writes — see Non-Goals).
- **`helpers.ts`** — `freshIngest` (insert per thought), `resolveProjectNames`
  (projects name lookup).
- **`tools/tasks.ts`** — `create_task` (insert), `list_tasks` (select + filters,
  project/person name lookups), `update_task` (update), `archive_task` (update),
  `get_tasks` (select-by-ids, project/person/parent lookups).
- **`extractors/task-extractor.ts`** — Phase 2 (update matched), Phase 3 (insert
  new), Phase 4 (parent_id update), Phase 5 (guarded archive).

## Goals / Non-Goals

**Goals**
- A `ThoughtRepository` and `TaskRepository` seam covering exactly those
  touch-points, injectable and fakeable.
- One shared `resolveNames` helper replacing the four inline copies in `tasks.ts`.
- Zero behavior change; integration suite untouched and green.
- Unit tests that could not exist before the seam: repository impls against a
  fake Supabase client, `resolveNames`, and ≥1 handler driven by a fake repo.

**Non-Goals** (deferred, see proposal)
- `projects`/`people`/`documents`/`ai_output`/`queries` repositories → Step 17.
- `note_snapshots` access → later step; `handleIngestNote` keeps raw `supabase`
  for it.
- Deleting `resolveProjectNames` and migrating its callers → Step 17.
- Handler decomposition → Step 18. Generated DB types → Step 24.

## Decisions

### D1: Repository methods return `RepoResult<T>`, they do not throw
Each method returns `{ data: T | null; error: { message: string } | null }`
(a `RepoResult<T>`), mirroring the shape handlers already destructure from
supabase-js. **Why:** the goal is a *pure* refactor with the integration suite
untouched. If repositories threw, every handler's `if (error)` branch — which
carries deliberate finding-C9 error-surfacing — would have to be rewritten as
try/catch, multiplying risk. Returning a narrow result keeps handler control
flow line-for-line equivalent while still hiding table names, columns, filters,
and RPC wiring behind the interface. *Alternative considered:* throw + typed
errors (as `AiProvider` does). Rejected here because `AiProvider` had few call
sites with uniform fallback, whereas these ~30 handlers have varied,
individually-meaningful error branches. The interface is still fully fakeable
(a fake returns canned `RepoResult`s), which is what X2 requires.

### D2: "Not found" is modeled as `{ data: null, error: null }`
`get_thought_by_id` and `archive_thought` today branch on the supabase
`PGRST116` ("no rows") code to render a friendly not-found message distinct from
a real error. The repository absorbs that: a single-row lookup that finds
nothing returns `data: null, error: null`; any other failure returns a populated
`error`. Handlers then read `if (error) …; if (!data) …not found…`, preserving
both messages without leaking the postgrest error code through the interface.

### D3: `resolveNames(supabase, table, ids, nameColumn = "name")` is a shared free function
Placed in `repositories/name-resolution.ts`, not a method on a repository,
because it is entity-generic (projects, people, and — with `nameColumn:
"content"` — parent tasks) and Step 17 will reuse it across many tools. It keeps
the existing semantics exactly: dedupe ids, single `IN` query, and on lookup
**error** log + fall back to a raw-id→raw-id map (never a silently empty map
that would hide the failure — finding C9). `resolveProjectNames` becomes a
one-line delegate to it, removing that duplicate immediately (its call-site
migration and final deletion stay in Step 17).

### D4: Injection surface
- `index.ts` constructs `new SupabaseThoughtRepository(supabase)` and
  `new SupabaseTaskRepository(supabase)` once (stateless wrappers over the
  shared client) and injects them.
- `register(...)` gains parameters: `thoughts.ts` (+thoughtRepository,
  +taskRepository), `tasks.ts` (+taskRepository), `documents.ts`
  (+taskRepository — forward-only). `supabase` stays where still needed
  (`resolveNames`, `note_snapshots`, `runExtractionPipeline`).
- `ExtractionContext` gains `taskRepository: TaskRepository`;
  `runExtractionPipeline(note, extractors, supabase, aiProvider, taskRepository)`
  forwards it. `TaskExtractor` uses `context.taskRepository`.
- `handleIngestNote(supabase, aiProvider, thoughtRepository, taskRepository, {…})`
  and the `HttpRouteContext` gain the repositories.

### D5: One or two handlers extracted to named functions for the seam test
To satisfy "unit tests for one or two handlers using a fake repository," the
`list_tasks` handler body is extracted into an exported
`buildTaskListText(tasks, projectNames, personNames)` (pure formatter) plus the
handler calling `taskRepository.list` + `resolveNames`. The unit test drives it
with a fake `TaskRepository` and a fake resolver — no DB. This is a
behavior-preserving extraction (the registered closure simply calls the named
function); deeper decomposition is Step 18.

## User Error / Edge Scenarios
- **LLM-hallucinated thought id in the reconcile `delete`/`update` list** →
  unchanged: the repository `update`/`archive` targets a non-existent id, which
  is a no-op that returns no error (Step 4's soft-archive semantics are
  preserved; the repo does not add affected-row verification — that is Step 24).
- **DB lookup error during name resolution** → `resolveNames` logs and falls
  back to raw ids; the list still renders (no swallow-to-empty).
- **Single-row lookup finds nothing** → `{data:null,error:null}` → friendly
  "not found" text (D2), not a thrown error.
- **Empty `ids` / over-limit `ids`** in `get_tasks` → validated in the handler
  before the repository is called (unchanged).

## Security Analysis
No new external input surface, no new endpoints, no auth changes. The refactor
moves existing queries behind interfaces without altering their filters, so RLS
and the service-role boundary are unaffected. `resolveNames` uses parameterized
`.in(...)` (no string interpolation) exactly as the inline code did. The
`ilike`-wildcard escaping and enum/uuid validation hardening are Step 24, not
regressed here. No `ThreatModel.md` delta is warranted for a behavior-neutral
internal refactor.

## Test Strategy
- **Unit (new, `tests/unit/`)** — (a) `SupabaseThoughtRepository` /
  `SupabaseTaskRepository` against a hand-written fake Supabase client that
  records the query chain and returns canned rows, asserting each method builds
  the right table/columns/filters and maps results; (b) `resolveNames` success,
  raw-id fallback on error, and empty-input cases; (c) the extracted `list_tasks`
  handler with a fake `TaskRepository` + fake resolver, proving a handler now
  runs with no DB. These satisfy GATE 2b: deleting a repository method body fails
  its test.
- **Integration (existing, `tests/integration/`)** — the full Deno suite is the
  behavior safety net and MUST pass **unmodified**. If any integration test
  needs editing, that is a signal the refactor changed behavior — investigate,
  don't edit.
- **Plugin suite** — untouched by this change; run for GATE 4 completeness.

## Risks / Trade-offs
- [A broad, mechanical rewire touching ~8 files could drop a query filter or
  column] → Move one method at a time; lean on the untouched integration suite;
  grep to confirm no `supabase.from("thoughts"|"tasks")` remains in the four
  files at the end.
- [`RepoResult` leaks a `{data,error}` shape rather than a richer domain type] →
  Accepted: it is the minimal contract that keeps this a pure refactor; the
  interface is still fakeable, which is the property X2 needs. Types tighten in
  Step 24.
- [Two name-resolution helpers (`resolveNames` + `resolveProjectNames`)
  briefly coexist] → Mitigated by making `resolveProjectNames` delegate to
  `resolveNames` so there is one implementation; the wrapper is removed in
  Step 17.

## Migration Plan
Pure code refactor, no DB migration, no config. Deploys as a normal edge-function
update. Rollback = revert the branch; no data or schema is touched.

## Open Questions
None blocking. `note_snapshots` repository placement (own repo vs. folded into
thoughts) is deferred to the step that migrates it.
