## Why

Step 5 (`memory-lifecycle-rules-spec`) turned the memory & task lifecycle rules and the PMS↔TB
sync rules into exhaustive GIVEN/WHEN/THEN specs, each tagged `test` (deterministic) or `eval`
(LLM-behavior). Those scenarios are acceptance criteria with no executable enforcement yet. Step 7
will implement the hygiene features (dedup gate, supersession, staleness/archival queues, task
reconciliation, the actor model, extraction-`type` allowlist, INVARIANT-1 re-embed/re-hash). Per
the plan this is **TDD at phase scale**: the tests come first (this step), then the implementation
(Step 7). This change builds that executable harness so Step 7 has a concrete, failing target.

## What Changes

- **Deterministic integration tests** on the real local Supabase stack (`TB_AI_PROVIDER=fake`, no
  mocks on the tested path) for **every `test`-tagged scenario** in `memory-lifecycle-rules` and
  `integration-sync-rules`. These live in `tests/integration/lifecycle/` and are picked up by the
  existing `deno task test` gate.
- **BREAKING (process, intentional):** most of these deterministic tests are **red-by-design** —
  they encode Step 7 behavior that does not exist yet, so `deno task test` fails until Step 7 lands.
  Each red test is written to fail for one **documented** reason (the feature is absent), asserted
  via a per-scenario "pending Step 7" reason string, so a red-by-design failure is always
  distinguishable from a genuinely broken test. Scenarios whose behavior already ships today
  (INVARIANT-1 re-embed/re-hash on thoughts, `get_thought_by_id` auto-record, server-side
  usefulness increment, `returned_ids`/`records_returned` logging) are written to **pass now**.
- **Opt-in scored eval harness** for every `eval`-tagged scenario: scripted fixtures, a scored
  pass-rate against a documented threshold, run via a new explicit `deno task` (sibling of
  `test:live-llm`) — never a silent skip, never part of the default green gate.
- **A scenario→test coverage manifest** proving every Step 5 scenario maps to exactly one harness
  entry (deterministic or eval), so coverage gaps are detectable and Step 7 can track its burn-down.
- **A CI job** that runs the deterministic tier (documented as red until Step 7, with the
  burn-down count surfaced), plus the eval tier gated behind an explicit opt-in.
- **No feature implementation, migration, schema, or data change** — that is Step 7.

## Capabilities

### New Capabilities
- `lifecycle-rules-verification`: the executable verification harness for the Step 5 lifecycle & sync
  rules — the deterministic integration tier, the opt-in scored eval tier, the scenario→test
  coverage manifest, the red-by-design semantics (fail for a documented reason pending Step 7), and
  the CI wiring.

### Modified Capabilities
<!-- None at the requirement level. The new lifecycle tests reuse the existing `test-infrastructure`
     conventions (shared `tests/helpers/mcp-client.ts`, self-contained fixtures, deterministic
     default + opt-in tiers) without changing that spec's requirements. -->

## Impact

- **New test code:** `tests/integration/lifecycle/**` (deterministic tier), `tests/eval/**`
  (scored eval tier), `tests/lifecycle-coverage.manifest.ts` (scenario→test map + coverage check).
- **`deno.json`:** a new opt-in task for the eval tier (e.g. `test:lifecycle:eval`); the
  deterministic tier rides the existing `deno task test`.
- **CI (`.github/workflows/`):** a job/step running the deterministic tier (red-by-design burn-down)
  and an opt-in eval step.
- **`ThreatModel.md`:** verification-harness integrity notes (a passing harness must not mask an
  unimplemented rule; red-by-design must be honest).
- **No change** to `supabase/functions/**`, migrations, or the Obsidian plugin.
- **Reads/depends on:** `openspec/specs/memory-lifecycle-rules/spec.md`,
  `openspec/specs/integration-sync-rules/spec.md` (source scenarios), and the
  `test-infrastructure` conventions.
