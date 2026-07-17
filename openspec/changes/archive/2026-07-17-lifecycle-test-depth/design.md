## Context

The lifecycle harness had `pass-now` manifest entries whose tests only probed `hasTool`/`columnExists`. These pass once the tool/column ships but assert nothing about behavior — deleting `get_archival_queue`'s body or making `reconcile_tasks` auto-close leaves the suite green. The coverage bijection test validated names/tags/tiers but never `testRef`.

## Goals / Non-Goals

**Goals:**
- Every pass-now lifecycle scenario asserts durable behavior.
- The manifest guarantee extends to testRef existence + per-scenario anchoring.
- Clear stale pending/red-by-design titles on now-green tests; exercise the real actor path.

**Non-Goals:** implementing new production behavior (automatic in-band near-dup routing).

## Decisions

- **Fixtures: capture-then-patch.** Behavioral archival tests need thoughts in specific lifecycle states (old `created_at`, set `last_retrieved_at`, a `note_snapshot_id`). Capturing through the real tool gives a real embedding; a service-role `patchThought` then places the row in the target state. This reuses production code for the hard part (embedding) and only backdates metadata.
- **Embed-distinct fixtures.** Because the write-time dedup gate now really deduplicates, sibling fixtures use disjoint word sets so they are not collapsed into one row.
- **Dedup near-dup scenario tests PRESERVATION, not automatic routing.** In-band near-dups are dropped by the gate (by design; detection of a *cross-context* near-dup worth keeping is model judgment, opt-in eval tier). The behavioral test asserts the implemented supersession-candidate mechanism: distinct thoughts are both preserved and one can be routed to supersession with the older row KEPT (reversible), never silently deleted. This is honest behavioral coverage of shipped code rather than a probe or a test of unimplemented behavior.
- **Optional `testNameContains` anchor + existence check.** Making the field optional avoids annotating all ~30 entries while still (a) killing dead references for every pass-now entry and (b) anchoring the scenarios rewritten here to their named tests. The anchor check was verified to fail on a bad anchor (GATE 2b).
- **`sha256Hex` moved to `_thoughts.ts`** and imported by both `invariant1_reembed_rehash.test.ts` and the supersession re-hash test (Rule of Three).

### User error scenarios

Not applicable (test-only change). The behavioral tests themselves guard the product's user-error handling (consent gates, dedup).

### Security analysis

No production surface change. The consent/archival behavioral tests strengthen coverage of the "never auto-destroy user memory / never auto-close" invariants. No ThreatModel change.

### Test Strategy

Integration (deterministic tier) for the behavioral rewrites; unit for the coverage meta-test. Each rewritten probe now asserts durable state; GATE 2b for the anchoring check confirmed a wrong anchor reddens the meta-test.

## Risks / Trade-offs

- **Trade-off:** the dedup near-dup scenario name still says "near-duplicate" while the test uses distinct fixtures to exercise the preservation mechanism. Documented in-file; automatic in-band routing remains an eval-tier / v1.x concern rather than silently claimed here.
