## ADDED Requirements

### Requirement: AiOutputRepository interface abstracts all ai_output-table access

The MCP edge function SHALL define an `AiOutputRepository` interface as the single
seam over the `ai_output` table and its `get_pending_ai_output_metadata` RPC. It
SHALL expose only the operations current callers use — insert (returning id),
list-pending, list-pending-metadata, find-content-by-ids, mark-picked-up, and
reject. No code in `tools/` SHALL construct a `supabase.from("ai_output")` query
directly; the sole implementation is `SupabaseAiOutputRepository`.

#### Scenario: No inline ai_output query remains in tools

- **WHEN** `tools/` is searched for `from("ai_output")`
- **THEN** no match SHALL be found — every `ai_output`-table access goes through the repository

#### Scenario: HTTP handlers use the injected repository

- **WHEN** an AI-output HTTP route handler (get-pending / fetch-content / mark-picked-up / reject) runs
- **THEN** it SHALL obtain the repository from its handler arguments (threaded via `HttpRouteContext`) and SHALL NOT call `supabase.from("ai_output")`

#### Scenario: Repository methods carry data and error

- **WHEN** any `AiOutputRepository` method completes
- **THEN** it SHALL return either a `RepoResult` or the existing `{ data } | { error }` handler shape with `error` populated on failure, so callers keep their existing surfacing

### Requirement: create_tasks_with_output writes tasks and output through repositories

`create_tasks_with_output` SHALL insert its task rows through
`TaskRepository.insert`, roll back already-inserted tasks on failure through
`TaskRepository.deleteByIds`, resolve project/person names through `resolveNames`,
and insert the delivered document through `AiOutputRepository.insert`. Its
all-or-nothing task-creation guarantee (finding C4) SHALL be preserved unchanged.

#### Scenario: Mid-loop failure rolls back through the repository

- **WHEN** a task insert fails partway through `create_tasks_with_output`
- **THEN** the already-inserted task ids SHALL be deleted via `taskRepository.deleteByIds` and no `supabase.from("tasks")` call SHALL remain in the handler
