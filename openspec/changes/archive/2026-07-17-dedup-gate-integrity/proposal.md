## Why

The write-time dedup gate is a documented INVARIANT of `capture_thought`, but it was enforced only in the edge function: (1) `resolveDedup` destructured only `data` from its content-hash and embedding lookups, so a failed lookup read as "genuinely new content" and silently admitted a duplicate (CORE-2); and (2) the gate is a check-then-insert, so two concurrent captures of identical content both pass the in-memory check and both insert — nothing at the DB level enforced the invariant (TOOL-7).

## What Changes

- `resolveDedup` checks the error channel of both lookups and returns a `degraded` flag; `capture_thought` appends a "duplicate check unavailable" note instead of silently claiming the gate ran.
- New migration: a partial unique index on `thoughts(content_hash)` over active, non-superseded rows, making exact dedup atomic under concurrency.
- `capture_thought` and `freshIngest` treat the resulting `23505` unique-violation as the existing "Already captured" success path, never an error.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `memory-hygiene`: The write-time dedup gate is enforced at the database level (partial unique index) and surfaces a degraded outcome when the dedup lookup itself fails.

## Impact

- `helpers.ts` (`resolveDedup` error channels + `degraded`; `freshIngest` 23505 tolerance)
- `tools/thoughts.ts` (`capture_thought` degraded note + 23505 → "already captured")
- New migration `supabase/migrations/20260717000001_dedup_content_hash_unique.sql`
- Tests: `tests/unit/resolve-dedup.test.ts`, `tests/integration/dedup-concurrency.test.ts`

## Non-goals

- The projects/people auto-create interleave half of EXTR-7 (unique active-project-name index + 23505-recovering create-or-get) is Step 11 (Phase B).
- Near-duplicate (embedding-band) supersession semantics are unchanged.
