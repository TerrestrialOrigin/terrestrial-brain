# lifecycle-rules-verification Specification

## Purpose
TBD - created by archiving change lifecycle-rules-test-harness. Update Purpose after archive.
## Requirements
### Requirement: Every lifecycle scenario has exactly one executable harness entry

The system SHALL maintain a coverage manifest (`tests/lifecycle-coverage.manifest.ts`) that maps
every `#### Scenario:` in `openspec/specs/memory-lifecycle-rules/spec.md` and
`openspec/specs/integration-sync-rules/spec.md` to exactly one harness entry, recording its `tag`
(`test` | `eval`), its `tier` (deterministic | eval | sync), its `milestone` (`step7` | `v1.5` |
`shipped`), its `expectation` (`pass-now` | `pending`), and a reference to the test that covers it. A
meta-test SHALL parse both spec files and assert a bijection with the manifest, failing the build if
any scenario is uncovered, duplicated, or renamed without a matching manifest update.

#### Scenario: A scenario with no harness entry fails the build

- **WHEN** a new `#### Scenario:` is added to either lifecycle spec without a manifest entry
- **THEN** the coverage meta-test fails, naming the uncovered scenario

#### Scenario: A manifest entry with no matching scenario fails the build

- **WHEN** the manifest references a scenario heading that no longer exists in the specs
- **THEN** the coverage meta-test fails, naming the stale entry

#### Scenario: The manifest reports the burn-down

- **WHEN** the coverage meta-test runs
- **THEN** it reports the counts of `pass-now`, `pending step7`, and `pending v1.5` entries so the
  Step 7 (and v1.5) burn-down is legible from the test output

### Requirement: Deterministic scenarios run on the real local stack in the gated suite

The system SHALL implement every `test`-tagged `memory-lifecycle-rules` scenario as an integration
test under `tests/integration/lifecycle/` collected by `deno task test`, running against the real
local Supabase stack with `TB_AI_PROVIDER=fake` and NO mock on the tested path other than the
external-LLM seam. Assertions SHALL read durable database state (row counts, `metadata`, edges, queue
membership, stored hashes) via the service role, never transient response prose alone. Fixtures SHALL
be uniquely named and cleaned up in a `try/finally`.

#### Scenario: The deterministic lifecycle tests are part of the default gate

- **WHEN** `deno task test` runs
- **THEN** it collects the `tests/integration/lifecycle/` deterministic tests alongside the existing
  suite, exercising the running edge function over HTTP

#### Scenario: A deterministic assertion checks persisted state, not prose

- **WHEN** a lifecycle test asserts a rule's outcome (e.g. no duplicate row after an identical
  capture)
- **THEN** it verifies the database row state via the service-role REST surface, not only the tool's
  text response

### Requirement: Red-by-design tests fail for one documented reason

The system SHALL, for any `test`-tagged scenario describing behavior not yet implemented (Step 7 or
v1.5), provide a test that asserts the target behavior and fails **only** because the named feature is
absent. Each such test SHALL carry a `PENDING(<milestone>:<feature-slug>)` marker in its name and a
matching human-readable reason in its decisive assertion message. A red-by-design failure SHALL be
distinguishable from a broken test (a crash, a wrong route, an unexpected error).

#### Scenario: A pending test names its missing feature on failure

- **WHEN** a red-by-design test runs against current (pre-implementation) code
- **THEN** it fails with the documented `PENDING(...)` reason for the missing feature, not with an
  unrelated error, connection failure, or unknown-tool error for a surface that should already exist

#### Scenario: No lifecycle scenario is covered by a skip

- **WHEN** the lifecycle harness files are searched for `.skip`, `ignore: true`, or a conditional
  skip guard
- **THEN** none are found — pending scenarios are real failing tests, not silent skips

### Requirement: Already-shipped behaviors are proven green and non-vacuous

The system SHALL prove the harness runs against real behavior by covering the scenarios whose
behavior already ships — INVARIANT-1 re-embed/re-hash on thoughts (`update_thought`),
`get_thought_by_id` server-side auto-record, `record_useful_thoughts` server-side increment, and
`returned_ids`/`records_returned` logging — with tests that **pass now**. At least the
INVARIANT-1-on-thoughts and auto-record tests SHALL be shown non-vacuous by a mutation check (removing
the shipped implementation line reddens the test).

#### Scenario: Shipped-behavior tests pass against current code

- **WHEN** the pass-now lifecycle tests run against current `develop`
- **THEN** they pass, demonstrating the harness exercises real code paths and not only unbuilt ones

#### Scenario: Shipped-behavior tests are mutation-checked

- **WHEN** the shipped implementation line for INVARIANT-1-on-thoughts (or auto-record) is removed
- **THEN** the corresponding pass-now test fails, proving it is not vacuous

### Requirement: Eval scenarios run in an opt-in scored, thresholded tier

The system SHALL implement every `eval`-tagged scenario in an opt-in harness (`tests/eval/**`, run by
`deno task test:eval`) that uses the real provider, scores a labeled fixture set into a pass-rate, and
asserts the rate meets a documented threshold. The eval tier SHALL fail loudly (a clear
`requireEnv`-style error naming `OPENROUTER_API_KEY`) when run without a key — never a silent skip —
and SHALL NOT be part of the default `deno task test` gate.

#### Scenario: The eval tier scores against a threshold

- **WHEN** `deno task test:eval` runs with a valid `OPENROUTER_API_KEY`
- **THEN** each eval scenario computes a pass-rate over its labeled cases and asserts it meets the
  documented threshold

#### Scenario: The eval tier is fail-loud without a key

- **WHEN** `deno task test:eval` runs with no `OPENROUTER_API_KEY`
- **THEN** it fails with a clear error naming the missing key, and does not report a passing or
  skipped result

#### Scenario: The eval tier is excluded from the default gate

- **WHEN** `deno task test` runs
- **THEN** it does not execute the `tests/eval/**` tier

### Requirement: Sync scenarios are executable behind a v1.5 seam, opt-in and never skipped

Because the PMS connectors are a v1.5 horizon with no current surface, the system SHALL implement
every `test`-tagged `integration-sync-rules` scenario with full fixtures and assertions but route the
actor-invocation through a single `syncConnector` seam that currently raises
`PENDING(v1.5:connectors-unimplemented)`. These tests SHALL run under an explicit opt-in
`deno task test:sync-rules`, be recorded in the manifest with `milestone: v1.5`, and SHALL NOT be
silently skipped. They SHALL NOT gate the default `deno task test`.

#### Scenario: Sync tests exist and run opt-in

- **WHEN** `deno task test:sync-rules` runs
- **THEN** every `integration-sync-rules` `test` scenario executes and fails with the documented
  `PENDING(v1.5:connectors-unimplemented)` reason via the single seam

#### Scenario: Sync tests do not gate the default suite

- **WHEN** `deno task test` runs
- **THEN** it does not collect the sync-rules tier, so the Step 7 burn-down of the gated suite remains
  reachable

### Requirement: CI runs the deterministic tier and preserves lint/format signal

CI SHALL run the deterministic tier via `deno task test`, documented as red-by-design until Step 7,
and SHALL keep the lint and format checks running even when that tier is red (so those signals survive
the intentional red). The eval and sync tiers SHALL remain opt-in and outside the required CI path.

#### Scenario: Lint and format still run under a red deterministic tier

- **WHEN** the CI backend job runs while the deterministic lifecycle tier is red-by-design
- **THEN** `deno lint` and `deno fmt --check` still execute and report their own status

#### Scenario: Eval and sync tiers are not in the required CI path

- **WHEN** the default CI backend job runs
- **THEN** it does not require `deno task test:eval` or `deno task test:sync-rules` to pass

### Requirement: Dedup-band fixtures assert their embedding precondition

Dedup `test` scenarios SHALL compute their fixtures' cosine distances from the production
`FakeAiProvider` embedding and assert each fixture falls in its intended range (identical/near-dup
inside the 0.05–0.10 band; distinct content well beyond it) before asserting the dedup rule, so a
fixture that drifts out of band fails its own precondition rather than silently invalidating the rule
under test.

#### Scenario: A near-dup fixture proves it is in-band

- **WHEN** a dedup near-duplicate test sets up its fixture pair
- **THEN** it first asserts the pair's fake-embedding cosine distance is within the dedup band, then
  asserts the dedup outcome

#### Scenario: A distinct-content fixture proves it is out-of-band

- **WHEN** a "written normally" test sets up genuinely distinct content
- **THEN** it first asserts the fake-embedding distance is well beyond the dedup band, then asserts
  the thought is written as a new row

### Requirement: Shipped lifecycle behaviors are proven behaviorally, not by capability probes

A lifecycle scenario marked `pass-now` in the coverage manifest SHALL be verified by asserting durable behavior (database state or tool output), NOT merely that a tool is registered or a column exists. Deleting or breaking the implementation of a covered behavior SHALL turn its test red.

#### Scenario: The archival conjunction is verified against seeded rows

- **WHEN** a thought satisfying the full archival conjunction and near-miss thoughts each violating exactly one signal are present
- **THEN** the archival queue contains the full-conjunction thought and excludes every near-miss, and a synced-note-owned thought is excluded

#### Scenario: The reconciliation consent invariant is verified against task state

- **WHEN** the reconciliation sweep runs over an open task
- **THEN** the sweep surfaces the task with a confirm-to-close prompt and the task's status remains `open` (the sweep never auto-closes)

#### Scenario: The consent archive is verified against archived_at

- **WHEN** a queued item is archived via the consented tool and another queued item is not
- **THEN** the archived item has `archived_at` stamped and the unconfirmed item stays active

### Requirement: The coverage manifest verifies each pass-now testRef exists and is anchored

The coverage meta-test SHALL assert, for every `pass-now` entry, that its `testRef` file exists; and for every entry carrying a `testNameContains` anchor, that the referenced file contains a `Deno.test` whose name includes the anchor. A testRef pointing at a deleted/renamed file, or an anchor matching no test, SHALL fail the build.

#### Scenario: A dead testRef fails the build

- **WHEN** a pass-now entry's testRef file does not exist
- **THEN** the coverage meta-test fails

#### Scenario: An unmatched anchor fails the build

- **WHEN** an entry's `testNameContains` matches no `Deno.test` name in its testRef file
- **THEN** the coverage meta-test fails

