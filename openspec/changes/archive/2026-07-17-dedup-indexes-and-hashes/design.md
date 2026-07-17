## Context

Re-ingest and concurrent-ingest defects (EXTR-5, EXTR-7) plus a confirmed non-action (SQL-2). Verified against the schema: `people.name` is `unique` (exact); `projects.name` has no unique constraint; `tasks.content_hash` exists and `update_task` re-stamps it, but the extractor does not. `toRepoError` surfaces the PostgREST `code`, so `23505` is observable at call sites. Step 5's `uq_thoughts_content_hash_active` (partial unique on `content_hash`) already serves the `findByContentHash` equality lookup — verified by index definition — so SQL-2 needs no new index.

## Goals / Non-Goals

**Goals:**
- Re-stamp `content_hash` on every extractor content write.
- Make project/person auto-create idempotent under concurrency: unique active-project-name index + `23505`-recovering create-or-get on both paths.
- Confirm and comment the SQL-2 non-action.

**Non-Goals:** speculative `content_hash` plain index; query bounding (Step 12); test-name hygiene (Step 30); changing tool-level create semantics beyond the DB constraint.

## Decisions

**D1 — Partial unique index `unique (lower(name)) where archived_at is null`.** Case-insensitive to match the extractor's `name.toLowerCase()` comparison; scoped to active rows so archived duplicates (a legitimate historical state) don't collide. Verified the current seeded DB has zero duplicate active `lower(name)` projects, so the index applies cleanly. Alternative (a plain `unique(name)`) rejected: it would be case-sensitive (misaligned with matching) and would forbid re-creating a name whose prior project was archived.

**D2 — Create-or-get via `23505` recovery, not a pre-check.** A pre-`SELECT` then `INSERT` is itself a check-then-insert race. Instead: attempt the insert; if it fails with `23505`, `findByName` the active row and return its id. This is atomic-at-the-DB and idempotent — the winning racer inserts, the loser recovers the winner's row. Mirrors the capture_thought `23505`→"already captured" pattern from Step 5. `findByName` returns the active row (`archived_at is null`) for projects (case-insensitive) and the exact-name row for people (matching each table's unique key).

**D3 — Extractor re-stamps `content_hash` inline where it sets `content`.** `updateMatchedTasks` adds `updates.content_hash = await hashContent(state.content)`; `createNewTasks` adds `insertData.content_hash`. `NewTaskValues` gains `content_hash?: string`. This makes the extractor a faithful member of the "one server-side update path," so the dedup gate never compares against a stale hash.

### User error scenarios
- **Two concurrent ingests, same new project name:** one insert wins, the other gets `23505` and recovers the winner's id; exactly one active row, both runs reference the same id. (Integration test.)
- **Concurrent ingests, same new person name:** same recovery; the person reference is never dropped.
- **`findByName` itself errors during recovery:** the auto-create returns null and records the error in the run's `errors` (surfaced to the caller per EXTR-6, already landed) — a broken lookup is not swallowed into a silent drop.
- **Re-ingest edits a checkbox's text:** the matched task's `content_hash` updates to the new content's hash; a subsequent dedup comparison is correct.
- **Archived same-named project exists:** creating a new active project with that name is allowed (index is active-scoped); no false collision.

### Security analysis
- No new external inputs or privileges. The unique index is a data-integrity control; `findByName` is a service-role read behind the existing repository seam. Recovery re-queries by the exact name attempted (no injection surface — parameterized through the query builder). No PII exposure change.
- Threat: a hostile note names a project identical to an existing one to hijack references — unchanged from today (matching already unifies by name); the index just prevents duplicate rows.

### Test Strategy
- **Unit (fakes, no DB):** `matchOrCreateProject`/`createPerson` — fake repo `insert` returns `{error:{code:"23505"}}`, `findByName` returns the existing identity → assert the existing id is returned and no error recorded; a `findByName` that errors → assert null + error recorded (GATE 2b: removing the `23505` branch reddens the recovery test).
- **Unit/merge:** `updateMatchedTasks`/`createNewTasks` set `content_hash` = `hashContent(content)` (assert via fake task repo capturing the update payload).
- **Integration (real DB, reset stack):** two concurrent `ingest`/`update_document` runs referencing the same new project and the same new person → exactly one active row each, both runs share the id; after a re-ingest that changes a task's content, the row's `content_hash` equals SHA-256 of the new content.
- Mock-boundary: unit tests fake the repo seam; integration tests use the real DB with zero mocks on the path.

## Risks / Trade-offs

- **[Adding the unique index breaks a test that creates duplicate active names]** → Audited: each fixed project name is created once per reset run; generated names use `uniqueName()`; seed-name literals in tests are references, not creations. The gate resets the stack first. If a latent duplicate surfaces, it is a real integrity bug to fix, not tuned around.
- **[`create_project`/`create_person` tools now reject a duplicate active name with a DB error]** → Desirable (no duplicate projects); no test asserts duplicate-creation is allowed. Out of scope to add a friendly tool-level message here; the extractor path (the finding's target) recovers gracefully.
- **[Extra `findByName` round-trip on the rare race]** → Only on `23505`, i.e. the contended path; negligible.
