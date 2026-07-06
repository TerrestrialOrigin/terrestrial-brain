## ADDED Requirements

### Requirement: DocumentRepository interface abstracts all documents-table access

The MCP edge function SHALL define a `DocumentRepository` interface as the single
seam over the `documents` table. It SHALL expose only the operations `tools/documents.ts`
uses — insert (returning id, title, project_id), find-by-id, list-with-filters,
find-for-update, and update. No code in `tools/` SHALL construct a
`supabase.from("documents")` query directly; the sole implementation is
`SupabaseDocumentRepository`.

#### Scenario: No inline documents query remains in tools

- **WHEN** `tools/` is searched for `from("documents")`
- **THEN** no match SHALL be found — every `documents`-table access goes through the repository

#### Scenario: Not-found is distinguishable from error

- **WHEN** `get_document` looks up an id that does not exist
- **THEN** the repository SHALL surface the `PGRST116` no-rows code so the handler renders its friendly "No document found" message rather than a generic error, exactly as before

#### Scenario: Repository methods carry data and error

- **WHEN** any `DocumentRepository` method completes
- **THEN** it SHALL return a `RepoResult` whose `error` is populated on failure, so handlers keep their existing `if (error)` surfacing

### Requirement: DocumentRepository is injected, never a module-level singleton

`SupabaseDocumentRepository` SHALL be constructed once at the `index.ts`
composition root and injected into `tools/documents.ts` via `register(...)`. The
`update_document` stale-thought cleanup SHALL go through
`ThoughtRepository.archiveByDocumentReference`, not an inline
`supabase.from("thoughts")` call.

#### Scenario: Stale-thought cleanup goes through the thought repository

- **WHEN** `update_document` archives thoughts linked to the updated document
- **THEN** it SHALL call `thoughtRepository.archiveByDocumentReference(id)` and SHALL NOT call `supabase.from("thoughts")`
