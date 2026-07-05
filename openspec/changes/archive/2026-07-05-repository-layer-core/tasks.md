## 1. Repository interfaces & shared types

- [x] 1.1 Add `repositories/repo-result.ts` defining `RepoResult<T> = { data: T | null; error: { message: string } | null }` (and a `RepoError` alias for void-data mutations).
- [x] 1.2 Add `repositories/thought-repository.ts` — the `ThoughtRepository` interface with only current-caller methods (vector match, list, countActive, listForStats, findById, findForUpdate, findActiveById, findByReference, insert, update, archive, incrementUsefulness) and the row/param shapes they use.
- [x] 1.3 Add `repositories/task-repository.ts` — the `TaskRepository` interface with only current-caller methods (insert→{id,content}, list, findByIds, update, archive, archiveIfActive) and its row/param shapes.
- [x] 1.4 Add `repositories/name-resolution.ts` exporting `resolveNames(supabase, table, ids, nameColumn = "name"): Promise<Map<string,string>>` with dedupe, single `IN` query, and raw-id fallback on error (finding C9 semantics).

## 2. Repository implementations

- [x] 2.1 Implement `repositories/supabase-thought-repository.ts` (`SupabaseThoughtRepository`) — move every `thoughts` query/RPC currently in `tools/thoughts.ts` and `helpers.ts` here; map `PGRST116` single-row misses to `data:null,error:null` (D2).
- [x] 2.2 Implement `repositories/supabase-task-repository.ts` (`SupabaseTaskRepository`) — move every `tasks` query currently in `tools/tasks.ts` and `extractors/task-extractor.ts` here, including the guarded `archiveIfActive` (archived_at + status done, only where archived_at is null).

## 3. Rewire thoughts

- [x] 3.1 `helpers.ts`: `freshIngest` inserts via `ThoughtRepository`; make `resolveProjectNames` a thin delegate to `resolveNames`.
- [x] 3.2 `tools/thoughts.ts` `register(...)`: add `thoughtRepository` and `taskRepository` params; rewire all 8 tool handlers (search/list/stats/get-by-id/capture/update/record-useful/archive) to the repository. Preserve every error branch, not-found message, and output text verbatim.
- [x] 3.3 `tools/thoughts.ts` `handleIngestNote(...)`: add `thoughtRepository` + `taskRepository` params; route find-by-reference, reconcile update/insert/archive through the repository (archive, never delete — finding C2/C3). Leave `note_snapshots` reads/writes as raw `supabase` (out of scope); forward `taskRepository` into `runExtractionPipeline`.

## 4. Rewire tasks

- [x] 4.1 `tools/tasks.ts` `register(...)`: add `taskRepository` param; rewire `create_task`, `list_tasks`, `update_task`, `archive_task`, `get_tasks` to the repository.
- [x] 4.2 `tools/tasks.ts`: replace the four inline project/person/parent name-resolution blocks with `resolveNames` calls (parent tasks via `nameColumn: "content"`). Keep `supabase` param only for `resolveNames`.
- [x] 4.3 Extract the `list_tasks` handler body into an exported pure formatter + a handler that calls `taskRepository.list` + `resolveNames`, so it can be unit-tested with a fake repository (D5). Behavior-preserving only.

## 5. Rewire extractor pipeline

- [x] 5.1 `extractors/pipeline.ts`: add `taskRepository: TaskRepository` to `ExtractionContext`; add the parameter to `runExtractionPipeline` and place it on the built context.
- [x] 5.2 `extractors/task-extractor.ts`: replace Phase 2/3/4/5 `context.supabase.from("tasks")` calls with `context.taskRepository` methods (Phase 5 → `archiveIfActive`).

## 6. Composition root & call sites

- [x] 6.1 `index.ts`: construct `SupabaseThoughtRepository` + `SupabaseTaskRepository` once; pass them into `createMcpServer` and the affected `register(...)` calls; add them to `HttpRouteContext` and the `handleIngestNote` call in the ingest-note route.
- [x] 6.2 `tools/documents.ts` `register(...)`: add `taskRepository` param and forward it into its `runExtractionPipeline` calls (forward-only; no thoughts/tasks handler changes here).

## 7. Unit tests (prove the seam)

- [x] 7.1 `tests/unit/name-resolution.test.ts`: `resolveNames` success map, raw-id fallback on query error, empty-input no-query — against a fake Supabase client.
- [x] 7.2 `tests/unit/task-repository.test.ts` (and a thought-repository counterpart): drive the Supabase repo impls with a fake client that records the query chain; assert table/columns/filters and result mapping for the key methods.
- [x] 7.3 `tests/unit/list-tasks-handler.test.ts`: drive the extracted `list_tasks` logic with a fake `TaskRepository` + fake resolver (no DB); assert formatted output and the error branch. Confirm GATE 2b: deleting a repo method body reddens its test.

## 8. Verification gates

- [x] 8.1 `deno lint` + `deno fmt --check` clean on the function + tests; `deno check` the function entrypoint.
- [x] 8.2 Grep confirms no `from("thoughts")` in `tools/thoughts.ts`/`helpers.ts` and no `from("tasks")` in `tools/tasks.ts`/`extractors/task-extractor.ts`.
- [x] 8.3 Full Deno suite green **with the integration tests unmodified** (`deno test --allow-net --allow-env tests/` against local Supabase; `OPENROUTER_API_KEY` set).
- [x] 8.4 Plugin suite untouched but run for completeness: `cd obsidian-plugin && npm test && npm run build`.
- [x] 8.5 `/opsx:verify`, then check off Step 16 in `codeEval/Fable20260704-fix-plan.md`.
