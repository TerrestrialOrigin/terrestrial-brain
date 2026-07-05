# task-repository Specification

## Purpose

Defines the `TaskRepository` seam — the single abstraction over the `tasks`
table — and the shared generic `resolveNames` id→name helper. It exists so
that every tasks query lives behind one interface with one Supabase
implementation, injected through tool registration and `ExtractionContext`
so a fake can be substituted in tests without a database (finding X2).

## Requirements

### Requirement: TaskRepository interface abstracts all tasks-table access

The MCP edge function SHALL define a `TaskRepository` interface as the single
seam over the `tasks` table. The interface SHALL expose only the operations
current callers use — insert (returning the new row's id and content),
list-with-filters, find-by-ids, update, archive, and the extractor's
guarded "archive-if-active" removal. No code in `tools/tasks.ts` or
`extractors/task-extractor.ts` SHALL construct a `supabase.from("tasks")` query
directly.

#### Scenario: No inline tasks query remains in scope

- **WHEN** `tools/tasks.ts` and `extractors/task-extractor.ts` are searched for `from("tasks")`
- **THEN** no match SHALL be found — every `tasks`-table access goes through the repository

#### Scenario: Create returns the new task identity

- **WHEN** `create_task` or `TaskExtractor` Phase 3 inserts a task
- **THEN** the repository's insert method SHALL return the created row's `id` (and `content` where the caller needs it) so downstream parent-linking works unchanged

#### Scenario: Repository methods carry data and error

- **WHEN** any `TaskRepository` method completes
- **THEN** it SHALL return a `RepoResult` whose `error` is populated on failure, so handlers keep their existing `if (error)` surfacing

### Requirement: TaskRepository is injected through registration and ExtractionContext

`SupabaseTaskRepository` SHALL be the only implementation, constructed once at
the `index.ts` composition root. It SHALL be injected into the tasks tool
module's `register(...)` and placed on `ExtractionContext` so `TaskExtractor`
obtains it via `context.taskRepository` rather than `context.supabase.from`. No
consumer SHALL read a task repository from a module-level global.

#### Scenario: Extractor uses the injected repository

- **WHEN** `TaskExtractor.extract` updates, inserts, or archives tasks
- **THEN** it SHALL call `context.taskRepository` and SHALL NOT call `context.supabase.from("tasks")`

#### Scenario: Handler unit-testable with a fake repository

- **WHEN** a unit test invokes the extracted `list_tasks` logic with a fake `TaskRepository`
- **THEN** it SHALL format results from the fake with no database call

### Requirement: Generic resolveNames helper replaces inline name resolution

A shared `resolveNames(supabase, table, ids, nameColumn?)` helper SHALL resolve a
list of ids to a `Map<string, string>` of id → display value via a single
batched `IN` query, defaulting the display column to `name`. On a lookup error it
SHALL log and fall back to a map of id → id (never a silently empty map that
hides the failure — finding C9). The four inline name-resolution copies in
`tools/tasks.ts` (`list_tasks` and `get_tasks` project, person, and parent-task
lookups) SHALL be replaced by calls to this helper, and `resolveProjectNames`
SHALL become a thin delegate to it.

#### Scenario: Names resolved via a single batched query

- **WHEN** `list_tasks` renders tasks that reference projects and people
- **THEN** it SHALL obtain the id → name maps from `resolveNames` (one query per table) rather than inline `from("projects")` / `from("people")` blocks

#### Scenario: Lookup failure falls back to raw ids

- **WHEN** `resolveNames` is called and the underlying query returns an error
- **THEN** it SHALL return a map that maps each requested id to itself, and the caller SHALL still render the list

#### Scenario: Empty input returns an empty map

- **WHEN** `resolveNames` is called with an empty id array
- **THEN** it SHALL return an empty map and issue no query
