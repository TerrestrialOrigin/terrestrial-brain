## Context

`resolveDedup` (helpers.ts) ran a content-hash lookup then an embedding match, destructuring only `data` from each — a failed query read as "no duplicate". And the gate is a classic check-then-insert: two concurrent `capture_thought` calls both miss and both insert. A prior run of the new concurrency test on the un-migrated stack produced **2** active rows for identical content, confirming the race.

## Goals / Non-Goals

**Goals:**
- Enforce exact dedup atomically at the DB, independent of edge-function timing.
- A failed dedup lookup never silently admits a duplicate.
- Preserve the "Already captured" user-facing outcome under both the pre-check hit and the concurrency-loss (23505) path.

**Non-Goals:** projects/people auto-create races (Step 11); near-duplicate supersession semantics.

## Decisions

- **Partial unique index, not a full one.** `unique (content_hash) where content_hash is not null and archived_at is null and superseded_by is null`. The predicate mirrors the search RPC's active-and-not-superseded filter so archived/superseded history (legitimately duplicate content_hash) is not constrained; NULL content_hash (legacy/seed) rows are excluded and never collide. Append-only migration, additive.
- **Degraded outcome over throw (CORE-2).** `resolveDedup` returns `{ duplicateOf, degraded }`; on a lookup error it logs and returns `degraded: true`. `capture_thought` still captures but appends a "duplicate check unavailable" note. Chosen over throwing because a transient dedup-read blip should not fail the capture outright — but it must be visible, not silent.
- **23505 → "Already captured".** Both `capture_thought` (single insert) and `freshIngest` (split loop) treat the unique-violation as success: the content is already stored. `freshIngest` simply does not rethrow on `error.code === "23505"`.

### User error scenarios

- Double-clicked / retried identical capture, or two clients racing → exactly one active row; the loser sees "Already captured".
- DB blip during the dedup lookup → capture proceeds with a visible "duplicate check unavailable" note instead of a silent possible-duplicate.

### Security analysis

No new external surface. The index is a data-integrity constraint. Error messages surfaced are repository messages (no secrets). No ThreatModel change.

### Test Strategy

- Unit (RED-first): `resolveDedup` returns `degraded: true` on each lookup error, `degraded: false` on clean miss/hit. RED captured by adding the `degraded` field but leaving the error checks unwired.
- Integration (RED-first): concurrent identical captures → exactly one active row. RED captured by running the test against the un-migrated stack (2 rows), GREEN after the migration applies the index.

## Risks / Trade-offs

- **Risk:** the unique index would fail to build if active, non-superseded duplicate `content_hash` rows already existed. Verified the seed sets no `content_hash` (all NULL, excluded), so the index builds clean; the app already deduped exact content via `resolveDedup`, so active duplicates are not expected in practice.
- **Trade-off:** cross-note byte-identical thoughts can no longer both be active. This is exactly the dedup invariant the gate already intended; the index makes it authoritative.
