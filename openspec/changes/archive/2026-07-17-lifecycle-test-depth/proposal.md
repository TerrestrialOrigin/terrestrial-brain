## Why

Several lifecycle scenarios were "covered" only by capability probes — `hasTool(...)` / `columnExists(...)` — while the coverage manifest marked them `pass-now` (behavior verified). Deleting the tool body or making it misbehave left the suite green (TEST-1/2/3): the archival multi-signal conjunction, the synced-note exclusion, the consent gate, and the `reconcile_tasks` never-auto-close invariant had **zero** behavioral coverage. The coverage meta-test also never checked `testRef` (TEST-5), so a reference to a deleted/renamed file stayed green forever. And now-shipped behavior still wore stale `pendingName(...)` / "red-by-design" titles (TEST-4), and the "user/sync edits don't reinforce usefulness" test passed no `actor` so it exercised the default LLM path (TEST-6).

## What Changes

- Replace the `hasTool`/`columnExists` probes in `archival.test.ts`, `task_reconciliation.test.ts`, `dedup_gate.test.ts`, and `supersession.test.ts` with behavioral tests asserting durable DB state (queue membership, `archived_at`, task `status`, `content_hash`, re-embed search).
- Add a coverage meta-test: every `pass-now` entry's `testRef` must exist, and (where a new optional `testNameContains` anchor is set) the file must contain a `Deno.test` whose name includes it.
- Remove stale `pendingName(...)`/"red-by-design" wrappers and comments from now-green tests.
- Pass `actor: "user"` (and add a `sync` sibling) in the usefulness-reinforcement test.
- Add shared lifecycle helpers (`patchThought`, `isoDaysAgo`, `createNoteSnapshot`, `sha256Hex`) and dedup the `sha256Hex` copy.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `lifecycle-rules-verification`: The already-shipped lifecycle behaviors are proven by behavioral assertions (not capability probes), and the coverage manifest's guarantee extends to verifying each pass-now `testRef` exists and is anchored to a real test.

## Impact

- Tests: `archival.test.ts`, `task_reconciliation.test.ts`, `dedup_gate.test.ts`, `supersession.test.ts`, `extraction_type_allowlist.test.ts`, `usefulness_reinforcement.test.ts`, `invariant1_reembed_rehash.test.ts`, `_thoughts.ts`, `lifecycle-coverage.manifest.ts`, `lifecycle-coverage.test.ts`
- No production code changes.

## Non-goals

- Implementing automatic in-band near-dup → supersession routing (detection is model judgment, opt-in eval tier). The dedup near-dup scenario asserts the supersession-candidate PRESERVATION mechanism, not automatic routing.
