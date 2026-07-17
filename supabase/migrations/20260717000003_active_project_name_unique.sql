-- Active-project-name uniqueness (change: dedup-indexes-and-hashes — EXTR-7).
-- `projects.name` had no unique constraint, so two concurrent ingests of notes
-- under the same new project both miss the in-memory snapshot and insert two
-- rows; every later heading/path match then picks one arbitrarily. Enforce
-- uniqueness at the DB so exactly one active project can hold a given name; the
-- extractor's auto-create treats the resulting 23505 as create-or-get (recovers
-- the winner's id via findByName).
--
-- Case-insensitive (lower(name)) to match the extractor's case-insensitive
-- name comparison; scoped to active rows (archived_at IS NULL) so archiving a
-- project frees its name for legitimate re-creation. Verified: the seeded DB has
-- no duplicate active lower(name) projects, so the index applies cleanly.
--
-- Append-only (docs/upgrade.md): additive partial unique index, no data change.
--
-- SQL-2 note: the thoughts.content_hash equality lookup on the capture hot path
-- is already served by 20260717000001's `uq_thoughts_content_hash_active`
-- (partial unique on content_hash over active, non-superseded rows) — no
-- separate content_hash index is added here (do not add speculative indexes).

create unique index if not exists uq_projects_active_name
  on public.projects (lower(name))
  where archived_at is null;
