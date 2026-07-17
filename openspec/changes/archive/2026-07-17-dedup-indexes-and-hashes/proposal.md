## Why

Three dedup/interleaving defects on the re-ingest path. (EXTR-5) The task extractor rewrites a task's `content` without re-stamping `content_hash`, leaving a **stale** hash that confidently mismatches the row's text — worse than a null hash for the dedup gate. (EXTR-7) `projects.name` has no unique constraint, so two concurrent ingests of notes under the same new project both miss the in-memory snapshot and insert **two** rows; `people.name` is unique, so the losing racer's insert fails `23505` and `createPerson` silently drops the person. (SQL-2) The `content_hash` equality lookup on the hot capture path — already served by Step 5's partial **unique** index `uq_thoughts_content_hash_active`, so no new index is needed; this is confirmed and documented rather than re-added.

## What Changes

- New append-only migration adding a partial unique index on active project names: `unique (lower(name)) where archived_at is null`, matching the case-insensitive matching the extractor already does.
- `TaskExtractor.updateMatchedTasks` and `createNewTasks` re-stamp `content_hash = hashContent(content)` whenever they write `content` (INVARIANT 1, the one server-side update path); add `content_hash?: string` to `NewTaskValues`.
- Make both extractor auto-create paths idempotent under races: on a `23505` unique violation, re-query the row by name and return its id (create-or-get). Add `findByName` to `PersonRepository` and `ProjectRepository`.
- SQL-2: confirm (and comment) that the `content_hash` lookup is served by the existing unique index; add no speculative index.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `memory-hygiene`: the task extractor's content edits SHALL re-stamp `content_hash` (the INVARIANT-1 "one update path" now includes the extractor); the write-time dedup index requirement notes the extractor path.
- `project-extractor`: auto-create SHALL be idempotent under concurrency (unique active-name index + `23505`-recovering create-or-get) so concurrent ingests of the same new project yield exactly one row and a shared id.
- `people-extractor`: auto-create SHALL recover from a `23505` name collision by returning the existing person's id instead of dropping the reference.

## Non-goals

- The `content_hash` plain index (SQL-2) — already served by Step 5's unique index; adding another is speculative.
- Broader query bounding (Step 12) or test-fixture-name hygiene (Step 30, TEST-10).
- Changing `create_project`/`create_person` tool semantics beyond what the DB unique index enforces.

## Impact

- `supabase/migrations/` (one new file), `extractors/task-extractor.ts`, `extractors/project-extractor.ts`, `extractors/people-extractor.ts`, `repositories/{person,project}-repository.ts` + Supabase impls, `repositories/task-repository.ts` (`NewTaskValues`), test fakes.
- Affected spec files: `openspec/specs/memory-hygiene/spec.md`, `openspec/specs/project-extractor.md` (or `project-extractor/`), `openspec/specs/people-extractor/spec.md`.
