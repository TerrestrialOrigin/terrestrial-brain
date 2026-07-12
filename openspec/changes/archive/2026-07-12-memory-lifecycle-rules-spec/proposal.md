## Why

Terrestrial Brain accumulates memory but cannot yet **curate** it. The Step 4 audit
(`codeEval/Fable20260712-MemoryMechanismAudit.md`) proved three hygiene mechanisms — dedup on
`capture_thought`, near-dup avoidance on ingest, and extraction `type` validation — rely on
prompt-nudge/LLM compliance and drift in production (8 exact-duplicate thoughts, ~13% recent
near-dup rate, 11 out-of-allowlist `type` rows). Before writing any hygiene code (Step 7) or its
tests (Step 6), the **rules themselves must be specified exhaustively** as condition→outcome
scenarios, with each rule classified as deterministic (`test`) or model-behavioral (`eval`) and
each mutation carrying an `actor` (LLM | user | sync). This is the single ruleset that the future
memory console (Step 17) and any PMS connector (v1.5+) obey — specced once, now, so no surface
grows its own parallel, more-permissive path.

## What Changes

- Add an exhaustive **memory & task lifecycle rules** delta spec: contradiction/supersession,
  temporal validity & staleness decay, usefulness reinforcement (incl. rubber-stamp
  down-weighting), archival, task reconciliation, write-time deduplication, extraction-type
  allowlist validation, and the **re-embed + re-hash invariant** on every content edit.
- Add an **integration sync rules** delta spec (PMS → TB ingest, consented close, ask-first
  creation, status precedence, webhook at-least-once idempotency) — implementation is deferred to
  the connectors roadmap (v1.5+), but the rules are specced here so the actor model and status
  ownership are defined once alongside the memory rules.
- Establish the **`actor` dimension** (LLM | user | sync) as a first-class column on every
  mutation scenario — the structural home of Invariant 2. The memory console gets NO separate
  ruleset; it flows through these same rules with `actor: user`.
- Tag every scenario **test** (deterministic — must always pass) or **eval** (LLM-behavior —
  scored pass-rate ≥ threshold), with a documented design bias toward moving rules from eval-land
  into test-land via server-side enforcement.
- Record the Step-4-handoff **decisions**: the write-time dedup distance threshold band, the
  `type` allowlist decision (extend with `instruction`/`decision` vs coerce, plus the fallback),
  and rubber-stamp down-weighting — in `design.md`, and encode their observable outcomes as
  scenarios.

**No code, schema, migration, or behavior changes** — this is a specification-only change. Every
rule becomes an input to Step 6 (tests/eval harness) and Step 7 (implementation), not a fix here.

## Capabilities

### New Capabilities
- `memory-lifecycle-rules`: the exhaustive condition→outcome ruleset governing every mutation of
  thoughts/projects/tasks/documents — supersession, staleness/decay, usefulness reinforcement,
  archival, task reconciliation, write-time dedup, extraction-type validation, the actor model,
  and the re-embed/re-hash invariant. Each scenario tagged `test` or `eval`.
- `integration-sync-rules`: the PMS↔TB synchronization ruleset (ingest, consented close,
  ask-first creation, status precedence, webhook idempotency) specced now, implemented later,
  sharing the `memory-lifecycle-rules` actor model with `actor: sync`.

### Modified Capabilities
<!-- None. This change specifies NEW target behavior that Step 7 will implement; it does not alter
     the requirements of any already-implemented capability. Existing specs (thoughts, tasks,
     update-thought, thought-repository, function-call-logging) are referenced as context, not
     modified. -->

## Non-goals

- **No implementation.** No handlers, migrations, repositories, or DB CHECK constraints change in
  this step. Enforcement lands in Step 7; the deterministic tests + eval harness land in Step 6.
- **No production data cleanup.** The 11 out-of-allowlist rows, 8 exact duplicates, and near-dup
  backlog from the Step 4 audit are inventory for a separate human-confirmed Step 7 task.
- **No connector build.** `integration-sync-rules` defines behavior for connectors that do not yet
  exist (v1.5+); no OAuth, webhook endpoints, or provider adapters are built here.
- **No memory-console UI.** Step 17 consumes these rules; it is not designed here.

## Impact

- **New spec files:** `openspec/specs/memory-lifecycle-rules/spec.md` and
  `openspec/specs/integration-sync-rules/spec.md` (created on archive from this change's deltas).
- **Downstream:** Step 6 maps every `test`-tagged scenario to an integration test and every
  `eval`-tagged scenario to a scored eval; Step 7 implements the enforcement; Step 17 (console)
  and future connectors inherit the actor model.
- **Docs:** `ThreatModel.md` gains a spec-integrity note (the ruleset is the authorization surface
  for mutations); no runtime code, APIs, or dependencies are touched.
