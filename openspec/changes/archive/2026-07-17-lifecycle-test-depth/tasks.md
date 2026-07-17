## 1. Behavioral test rewrites (replace probes)

- [x] 1.1 `archival.test.ts` (TEST-1): seed a full-conjunction thought + one-signal-violating near-misses; assert queue membership; synced-note exclusion; consented archive stamps `archived_at` while an unconfirmed item stays active.
- [x] 1.2 `task_reconciliation.test.ts` (TEST-2): create an open task; assert the sweep proposes it with a confirm-to-close prompt and leaves `status: open`; decline path leaves it open + unarchived.
- [x] 1.3 `dedup_gate.test.ts` (TEST-3): near-dup probe → behavioral preservation + supersession-candidate mechanism (older row kept, not deleted).
- [x] 1.4 `supersession.test.ts` (TEST-3): content_hash probe → editing a supersession survivor re-hashes (`content_hash` == sha256) and re-embeds (findable by new wording).

## 2. Harness + hygiene

- [x] 2.1 `usefulness_reinforcement.test.ts` (TEST-6): pass `actor: "user"`; add an `actor: "sync"` sibling.
- [x] 2.2 `extraction_type_allowlist.test.ts` (TEST-4): remove `pendingName`/`pending` wrappers; update stale header. Clear stale "red-by-design" labels in `dedup_gate.test.ts`.
- [x] 2.3 Shared helpers: `patchThought`, `isoDaysAgo`, `createNoteSnapshot`, `deleteNoteSnapshot`, `sha256Hex` in `_thoughts.ts`; dedup `sha256Hex` in `invariant1_reembed_rehash.test.ts`.
- [x] 2.4 `lifecycle-coverage.manifest.ts`: add optional `testNameContains`; anchor the rewritten scenarios.
- [x] 2.5 `lifecycle-coverage.test.ts` (TEST-5): add the testRef-exists + testNameContains-anchor meta-test.

## 3. Testing & Verification

- [x] 3.1 GATE 2b: a wrong `testNameContains` reddens the coverage meta-test (verified).
- [x] 3.2 Full `deno task test` on a reset stack green; lint + fmt clean.
- [x] 3.3 Validate + archive; check off Step 8 in the plan; commit.
