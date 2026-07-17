## 1. Failing tests first (RED)

- [x] 1.1 `tests/unit/resolve-dedup.test.ts`: a failed content-hash lookup and a failed embedding match each yield `degraded: true`; clean miss/hit are not degraded.
- [x] 1.2 `tests/integration/dedup-concurrency.test.ts`: concurrent identical captures → exactly one active row.
- [x] 1.3 Confirm RED: degraded tests fail (field always false); concurrency test yields 2 active rows on the un-migrated stack.

## 2. Fix (GREEN)

- [x] 2.1 `resolveDedup`: check both error channels; return `{ duplicateOf, degraded }`.
- [x] 2.2 Migration `20260717000001_dedup_content_hash_unique.sql`: partial unique index on `content_hash` over active, non-superseded, non-null rows.
- [x] 2.3 `capture_thought`: append a degraded note; treat `23505` as "Already captured".
- [x] 2.4 `freshIngest`: do not rethrow on `error.code === "23505"`.

## 3. Testing & Verification

- [x] 3.1 GATE 2b: degraded tests RED before the error-channel wiring; concurrency test RED (2 rows) before the migration.
- [x] 3.2 Full `deno task test` on a reset stack green; `deno check`, lint, fmt clean.
- [x] 3.3 Validate + archive; check off Step 5 in the plan; commit.
