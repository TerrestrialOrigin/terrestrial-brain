## ADDED Requirements

### Requirement: PersonRepository interface abstracts all people-table access

The MCP edge function SHALL define a `PersonRepository` interface as the single
seam over the `people` table. It SHALL expose only the operations current callers
use — insert (returning the new row's id and name), list-with-filters,
find-by-id, find-name, update, and archive. No code in `tools/` or `extractors/`
SHALL construct a `supabase.from("people")` query directly; the sole
implementation is `SupabasePersonRepository`.

#### Scenario: No inline people query remains in tools or extractors

- **WHEN** `tools/` and `extractors/` are searched for `from("people")`
- **THEN** no match SHALL be found — every `people`-table access goes through the repository

#### Scenario: Auto-create returns the new person identity

- **WHEN** `create_person` or `PeopleExtractor.createPerson` inserts a person
- **THEN** the repository's insert method SHALL return the created row's `id` and `name` so context enrichment and success messages are unchanged

#### Scenario: Repository methods carry data and error

- **WHEN** any `PersonRepository` method completes
- **THEN** it SHALL return a `RepoResult` whose `error` is populated on failure, so handlers keep their existing `if (error)` surfacing

### Requirement: PersonRepository is injected, never a module-level singleton

`SupabasePersonRepository` SHALL be constructed once at the `index.ts`
composition root and injected into `tools/people.ts` via `register(...)` and into
the extractor pipeline via `ExtractionContext`. No consumer SHALL read a person
repository from a module-level global.

#### Scenario: Extractor uses the injected repository

- **WHEN** `PeopleExtractor.createPerson` auto-creates a person
- **THEN** it SHALL call `context.personRepository.insert(...)` and SHALL NOT call `context.supabase.from("people")`
