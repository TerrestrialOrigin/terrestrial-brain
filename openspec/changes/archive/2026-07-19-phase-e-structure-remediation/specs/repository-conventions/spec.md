## ADDED Requirements

### Requirement: Repository consumers depend on narrow role-scoped interfaces

The `QueryRepository` and `ThoughtRepository` seams SHALL be split into narrow role-scoped interfaces along their existing concern boundaries: `QueryRepository` into project-summary reads, recent-activity reads, and note-snapshot reads; `ThoughtRepository` into search/retrieval, write-path, review-queue, usefulness, and erasure roles. The single Supabase implementation class per table SHALL implement all of its roles, and each tool handler (and each test fake) SHALL depend only on the role interface(s) it actually uses.

#### Scenario: Query repository roles are separate interfaces

- **WHEN** the repository interface files are inspected
- **THEN** the project-summary, recent-activity, and note-snapshot read methods are declared on separate exported interfaces, all implemented by the one `SupabaseQueryRepository` class

#### Scenario: A test fake implements only the role under test

- **WHEN** a unit test exercises a handler that needs only recent-activity reads
- **THEN** its fake implements only the recent-activity interface, without stubbing unrelated methods from other roles

### Requirement: Query-result wrapping is a single shared helper

`repo-result.ts` SHALL export a `runQuery` helper (and a `runWrite` variant for void writes) that awaits a PostgREST builder and produces the `{ data, error }` `RepoResult` envelope via `toRepoError`. Repository methods SHALL use these helpers instead of hand-writing the await-then-wrap block. When the underlying query errors, the returned envelope SHALL carry `data: null` (never a fabricated empty/zero value) alongside the error.

#### Scenario: Repository methods delegate to the shared helper

- **WHEN** the `supabase-*-repository.ts` implementations are searched for the inline `error: toRepoError(error)` wrapping block
- **THEN** the wrapping occurs in `repo-result.ts`'s helpers rather than being repeated per method

#### Scenario: Helper error path keeps data null

- **WHEN** `runQuery` receives a builder result with a non-null error
- **THEN** the returned envelope has `data: null` and the mapped `RepoError`

### Requirement: Repository update payloads are schema-typed

Every repository `update` method SHALL accept a payload typed as `Partial` of the generated database update-row type for its table (via an `UpdateRow<Table>` alias next to the existing `InsertRow`), not `Record<string, unknown>`. A misspelled or nonexistent column in an update payload SHALL be a compile-time error at the call site.

#### Scenario: Unknown column fails to compile

- **WHEN** a caller passes an object containing a key that is not a column of the target table to a repository `update`
- **THEN** TypeScript rejects the call at compile time

### Requirement: RPC row results cross the seam typed

`listPendingMetadata` SHALL return rows typed from the generated `get_pending_ai_output_metadata` RPC return type instead of `unknown[]`, following the same pattern as `ThoughtMatchRow`, so schema drift in the RPC surfaces as a compile-time error rather than a silent API contract change.

#### Scenario: Pending-metadata rows are typed

- **WHEN** the `AiOutputRepository` interface is inspected
- **THEN** `listPendingMetadata` declares a named row type derived from the generated database function types, and the pull-API handler consumes that type without casts
