# thought-repository Specification

## Purpose

Defines the `ThoughtRepository` seam — the single abstraction over the
`thoughts` table and its `search_thoughts_by_embedding` / `increment_usefulness` RPCs. It
exists so that every thoughts query/RPC lives behind one interface with one
Supabase implementation, injected (never a module-level singleton) so a fake
can be substituted in tests without a database (finding X2).

## Requirements

### Requirement: ThoughtRepository interface abstracts all thoughts-table access

The MCP edge function SHALL define a `ThoughtRepository` interface as the single
seam over the `thoughts` table and its associated RPCs (`search_thoughts_by_embedding`,
`increment_usefulness`). The interface SHALL expose only the operations current
callers use — vector match, list-with-filters, active-count, stats read,
find-by-id, find-for-update, find-active-by-id, find-by-reference, insert,
update, archive, and increment-usefulness. No tool handler or helper in
`tools/thoughts.ts` or `helpers.ts` SHALL construct a `supabase.from("thoughts")`
query or a `thoughts`-related `supabase.rpc(...)` call directly.

#### Scenario: No inline thoughts query remains in scope

- **WHEN** `tools/thoughts.ts` and `helpers.ts` are searched for `from("thoughts")`
- **THEN** no match SHALL be found — every `thoughts`-table access goes through the repository

#### Scenario: Vector match delegated to the repository

- **WHEN** `search_thoughts` runs a semantic search
- **THEN** it SHALL call the repository's vector-match method (which wraps `rpc("search_thoughts_by_embedding", …)`) rather than calling `supabase.rpc` inline

#### Scenario: Usefulness increment delegated to the repository

- **WHEN** `record_useful_thoughts`, `get_thought_by_id`, or `capture_thought` credit thoughts
- **THEN** they SHALL call the repository's increment-usefulness method rather than `supabase.rpc("increment_usefulness", …)` inline

### Requirement: Repository methods return a result carrying data and error

Every `ThoughtRepository` method SHALL return a `RepoResult<T>` value exposing a
`data` field and an `error` field, so callers keep their existing error-surfacing
without try/catch. A single-row lookup that matches no row SHALL return
`data: null` with `error: null` (distinguishing "not found" from a real failure);
any genuine failure SHALL return a populated `error`.

#### Scenario: Lookup error is surfaced, not swallowed

- **WHEN** a repository read fails at the database
- **THEN** the returned `RepoResult` SHALL carry a non-null `error` and the handler SHALL render an error message

#### Scenario: Not-found is distinct from error

- **WHEN** `get_thought_by_id` requests an id that does not exist
- **THEN** the repository SHALL return `data: null, error: null` and the handler SHALL render a friendly "no thought found" message rather than an error

### Requirement: SupabaseThoughtRepository is the single implementation, injected not global

`SupabaseThoughtRepository` SHALL be the only implementation, constructed once at
the `index.ts` composition root and injected into every consumer through
`register(...)` parameters and `handleIngestNote(...)` arguments. No consumer
SHALL import a repository instance from a module-level global.

#### Scenario: Repository threaded through tool registration

- **WHEN** the MCP server is constructed for a request
- **THEN** the thoughts tool module's `register(...)` SHALL receive the injected `ThoughtRepository` instance

#### Scenario: Handler unit-testable with a fake repository

- **WHEN** a unit test invokes a thoughts handler (or the extracted formatter) with a hand-written fake `ThoughtRepository`
- **THEN** the handler SHALL use the fake and perform no database call

### Requirement: Soft-archive semantics preserved through the repository

The repository's archive operation SHALL set `archived_at` and SHALL NOT delete
rows, preserving the soft-archive convention (finding C2/C3). The
reconciliation-plan `delete` path in `handleIngestNote` SHALL call the
repository's archive method, never a hard delete.

#### Scenario: Reconcile delete archives rather than destroys

- **WHEN** `handleIngestNote` executes a reconciliation plan whose `delete` list names a thought id
- **THEN** the repository SHALL set that thought's `archived_at` and the row SHALL still exist afterward
