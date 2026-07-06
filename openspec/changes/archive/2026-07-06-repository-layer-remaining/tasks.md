## 1. Extend the Step-16 repositories (additive)

- [x] 1.1 Extend `TaskRepository` interface + `SupabaseTaskRepository` with `countOpenByProject`, `countOpenByAssignee`, `findOpenIdsByProjects`, `archiveMany`, `deleteByIds`, `findByReference` (pipeline context seed). New row/param types as needed.
- [x] 1.2 Extend `ThoughtRepository` interface + `SupabaseThoughtRepository` with `archiveByDocumentReference(documentId)`.
- [x] 1.3 Add an `upsert` builder method to `tests/unit/fake-supabase-client.ts` (records op/payload/onConflict) so the note-snapshot upsert path is unit-testable.

## 2. New entity repositories (interface + Supabase impl)

- [x] 2.1 `repositories/project-repository.ts` + `supabase-project-repository.ts` (insert, list, findById, findParentName, listChildren, listChildrenBasic, collectDescendantIds, listActive, update, archiveManyActive).
- [x] 2.2 `repositories/person-repository.ts` + `supabase-person-repository.ts` (insert, list, findById, findName, listActive, update, archive).
- [x] 2.3 `repositories/document-repository.ts` + `supabase-document-repository.ts` (insert, findById, list, findForUpdate, update).
- [x] 2.4 `repositories/ai-output-repository.ts` + `supabase-ai-output-repository.ts` (insert, listPending, listPendingMetadata (RPC), findContentByIds, markPickedUp, reject).
- [x] 2.5 `repositories/note-snapshot-repository.ts` + `supabase-note-snapshot-repository.ts` (findContentByReference, upsert).
- [x] 2.6 `repositories/query-repository.ts` + `supabase-query-repository.ts` (all reads for `queries.ts`; each method one query; name resolution delegates to `resolveNames`).

## 3. Compose the repositories at the root

- [x] 3.1 `index.ts`: construct one instance of each new repository over the shared client; add them to `createMcpServer` params and `HttpRouteContext`; thread `aiOutputRepository` through the AI-output HTTP route handlers.
- [x] 3.2 Update every `register(...)` signature: projects (+project, +task), people (+person, +task), documents (+document, +project, +thought), ai_output (+aiOutput, +task), queries (+query), thoughts (+noteSnapshot).

## 4. Extractor pipeline injection

- [x] 4.1 `extractors/pipeline.ts`: add `projectRepository` + `personRepository` to `ExtractionContext` and `runExtractionPipeline` params; seed `knownProjects`/`knownPeople`/`knownTasks` via the repositories (no `supabase.from`).
- [x] 4.2 `extractors/project-extractor.ts`: `matchOrCreateProject` inserts via `context.projectRepository`.
- [x] 4.3 `extractors/people-extractor.ts`: `createPerson` inserts via `context.personRepository`.
- [x] 4.4 Update all `runExtractionPipeline(...)` call sites (`tools/thoughts.ts` ×2, `tools/documents.ts` ×2) to forward the new repos.

## 5. Rewire the tool handlers

- [x] 5.1 `tools/projects.ts` — all `projects`/`tasks` access via `projectRepository`/`taskRepository`.
- [x] 5.2 `tools/people.ts` — all `people`/`tasks` access via `personRepository`/`taskRepository`.
- [x] 5.3 `tools/documents.ts` — `documents` via `documentRepository`; project names via `resolveNames`; thought cleanup via `thoughtRepository.archiveByDocumentReference`.
- [x] 5.4 `tools/ai_output.ts` — HTTP handlers + `create_ai_output` + `create_tasks_with_output` via `aiOutputRepository`/`taskRepository`/`resolveNames`.
- [x] 5.5 `tools/queries.ts` — all reads via `queryRepository`; handler is orchestration + formatting only.
- [x] 5.6 `tools/thoughts.ts` — `note_snapshots` via `noteSnapshotRepository`; `resolveProjectNames` callers → `resolveNames`.
- [x] 5.7 `helpers.ts` — delete `resolveProjectNames`; remove its now-unused import.

## 6. Tests

- [x] 6.1 Add `tests/unit/*-repository.test.ts` for project, person, document, ai-output, note-snapshot, query repositories (fake client; assert table/columns/filters/mapping; GATE 2b).
- [x] 6.2 Add ≥1 handler-level unit test driving a rewired handler with a fake repository (no DB).

## 7. Verify

- [x] 7.1 `grep -rn 'supabase.from(' supabase/functions/terrestrial-brain-mcp/tools/ supabase/functions/terrestrial-brain-mcp/extractors/` returns nothing; `grep -rn resolveProjectNames` returns nothing.
- [x] 7.2 `deno task test` green (unit + integration, integration files UNMODIFIED); `deno lint` + `deno fmt --check` clean; `cd obsidian-plugin && npm test && npm run build` green.
- [x] 7.3 Mark Step 17 complete in `codeEval/Fable20260704-fix-plan.md`; `/opsx:verify`; `/opsx:archive`.
