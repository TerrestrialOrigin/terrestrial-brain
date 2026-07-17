## 1. Reproduce (tests first — fail RED)

- [x] 1.1 Unit: `matchOrCreateProject` — fake project repo `insert` returns `{error:{code:"23505"}}`, `findByName` returns an existing identity → assert existing id returned, no error recorded. Confirm RED (current code records error, returns null).
- [x] 1.2 Unit: `createPerson` — same 23505-recovery assertion. Confirm RED.
- [x] 1.3 Unit: extractor sets `content_hash = hashContent(content)` on matched-task update and new-task insert (capture the payload via fake task repo). Confirm RED.
- [x] 1.4 Integration: after a re-ingest that edits a checkbox, the matched task's `content_hash` equals SHA-256 of the new content. Confirm RED.
- [x] 1.5 Integration: two concurrent ingests referencing the same new project name → exactly one active row, same id; same for a new person name. Confirm RED (dup project rows today).

## 2. Migration (append-only)

- [x] 2.1 New `supabase/migrations/20260717000003_active_project_name_unique.sql`: `create unique index if not exists uq_projects_active_name on public.projects (lower(name)) where archived_at is null;` with a header comment; note SQL-2 is served by Step 5's `uq_thoughts_content_hash_active` (no new content_hash index).

## 3. Repositories

- [x] 3.1 Add `findByName(name)` to `ProjectRepository` (active, case-insensitive) + Supabase impl.
- [x] 3.2 Add `findByName(name)` to `PersonRepository` (exact name) + Supabase impl.
- [x] 3.3 Add `content_hash?: string` to `NewTaskValues` in `task-repository.ts`.
- [x] 3.4 Update test fakes in `tests/unit/fakes/extraction-fakes.ts` to implement `findByName` and to allow simulating a `23505` insert.

## 4. Extractors

- [x] 4.1 `TaskExtractor.updateMatchedTasks`: set `updates.content_hash = await hashContent(state.content)` alongside `content` (import `hashContent`).
- [x] 4.2 `TaskExtractor.createNewTasks`: set `insertData.content_hash = await hashContent(state.content)`.
- [x] 4.3 `ProjectExtractor.matchOrCreateProject`: on `error?.code === "23505"`, `findByName` and return the id; on lookup error return null + record error.
- [x] 4.4 `PeopleExtractor.createPerson`: same `23505` recovery via `findByName`.

## 5. Gates

- [x] 5.1 `npx supabase db reset`; confirm the new tests GREEN and GATE 2b (removing a recovery branch / the hash re-stamp reddens them).
- [x] 5.2 `npx supabase test db` (green), `deno task test` (green, 0 skips).
- [x] 5.3 `cd obsidian-plugin && npm test && npm run build` (green).
- [x] 5.4 `scripts/validate-all.sh` end-to-end — green.

## 6. Finalize

- [x] 6.1 `/opsx:verify`, sync delta specs, `/opsx:archive`.
- [x] 6.2 Check off Step 11 in `codeEval/Fable20260717RemediationPlan.md`.
- [x] 6.3 Commit on branch, merge into develop, push.
