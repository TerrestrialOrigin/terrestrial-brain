-- Dedup gate integrity (change: dedup-gate-integrity, TOOL-7). The write-time
-- dedup gate is a documented INVARIANT of capture_thought, but it was enforced
-- only by a check-then-insert in the edge function: two concurrent captures of
-- identical content both pass the in-memory check and both insert. Enforce the
-- invariant at the DB level so exact dedup is atomic under concurrency; the edge
-- function treats the resulting unique-violation (23505) as the existing
-- "Already captured" success path.
--
-- Append-only (docs/upgrade.md): additive partial index, no data change. The
-- predicate mirrors the search RPC's active-and-not-superseded filter, and NULL
-- content_hash rows (legacy/seed) are excluded so they never collide.

create unique index if not exists uq_thoughts_content_hash_active
  on public.thoughts (content_hash)
  where content_hash is not null
    and archived_at is null
    and superseded_by is null;
