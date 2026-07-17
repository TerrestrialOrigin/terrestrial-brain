## 1. Failing tests first (RED)

- [x] 1.1 `tests/unit/ingest-note-steps.test.ts`: foreign id in keep/update/delete is dropped; update-missing-content → null; non-array field → null; object-shaped add → null. Align the existing pass-through test's ids with its existing thought.
- [x] 1.2 Confirm RED (allowlist not applied; invalid shapes accepted).

## 2. Fix (GREEN)

- [x] 2.1 `tools/thoughts.ts`: add `ReconciliationPlanSchema` + `filterPlanToKnownIds`.
- [x] 2.2 `requestReconciliationPlan`: parse via schema in the callback (throw `AiProviderParseError` on failure), then allowlist-filter against the note's thought ids.
- [x] 2.3 `executeReconciliationPlan`: remove the `as unknown as { thought: string }` double-cast and the `as string` casts (schema guarantees strings).

## 3. Testing & Verification

- [x] 3.1 GATE 2b: allowlist/validation tests RED before the fix.
- [x] 3.2 Full `deno task test` on a reset stack green; `deno check`, lint, fmt clean.
- [x] 3.3 Validate + archive the change; check off Step 3 in the plan; commit.
