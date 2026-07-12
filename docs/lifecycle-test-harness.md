# Lifecycle rules verification harness

The executable acceptance harness for the Step 5 memory & task lifecycle rules
(`openspec/specs/memory-lifecycle-rules`) and PMS↔TB sync rules
(`openspec/specs/integration-sync-rules`). Built in Step 6
(`lifecycle-rules-test-harness`) as **TDD at phase scale**: the tests exist
before the implementation. Step 7 (memory hygiene) turns them green; the sync
tier greens at v1.5 (connectors).

## Tiers and how to run them

| Tier | Task | Gated? | State today |
|---|---|---|---|
| Deterministic | `deno task test` (includes `tests/integration/lifecycle/`) | **Yes** (CI) | **All 28 green** — Step 7 implemented the features |
| Eval (LLM-judgment) | `deno task test:eval` (`tests/eval/`) | No (opt-in) | Fail-loud without `OPENROUTER_API_KEY`; scored vs threshold; 4 scenarios still seam-gated pending real-LLM wiring |
| Sync (v1.5) | `deno task test:sync-rules` (`tests/sync-rules/`) | No (opt-in) | 14 tests, all pending v1.5 via the connector seam |

Step 6 wrote these red-by-design; **Step 7 (`memory-hygiene`) turned the
deterministic tier green** by implementing the dedup gate, supersession edge +
`resolve_supersession`, `content_hash`/INVARIANT-1 across all four entities, the
`last_actor` actor model, `last_retrieved_at` + `get_stale_thoughts` /
`get_archival_queue` / `reconcile_tasks` tools, rubber-stamp down-weighting, and
the extraction-type allowlist parse. CI keeps `deno lint` / `deno fmt --check`
running (`if: always()`).

## The red-by-design contract

Most deterministic tests encode behavior that does not exist yet. Each fails for
exactly one **documented** reason:

- Its name carries `[PENDING(<milestone>:<slug>)]`.
- Its decisive assertion message repeats that reason (`_pending.ts`).
- It anchors on real state — a durable DB assertion, or a `hasTool` /
  `columnExists` capability probe (`_tools.ts`) — never an ambiguous crash.

A red-by-design failure is therefore always distinguishable from a broken test.
The 5 **pass-now** tests (INVARIANT-1 re-embed on thoughts, `get_thought_by_id`
auto-record, server-side usefulness increment, distinct-content write,
allowlisted-type-as-is) prove the harness exercises real code, not only vapor.

## Coverage manifest (single source of truth)

`tests/lifecycle-coverage.manifest.ts` has one entry per spec scenario (47).
`tests/unit/lifecycle-coverage.test.ts` asserts a **bijection** with the specs —
a new, renamed, or removed scenario without a manifest update fails the build —
and logs the burn-down:

```
[lifecycle burn-down] pass-now=28 pending-step7=4 pending-v1.5=15 total=47
```

(The 4 remaining pending-step7 are the `eval`-tagged scenarios — opt-in,
seam-gated pending real-LLM wiring; the 15 pending-v1.5 are the sync-connector
scenarios. All 28 deterministic `test`-tagged scenarios are green.)

## For the Step 7 implementer

Burn the deterministic tier red→green by implementing each `PENDING(step7:*)`
feature; the assertion messages name what is missing (dedup gate, `content_hash`,
`superseded_by` edge, `last_actor`, `last_retrieved_at`, `get_stale_thoughts` /
`get_archival_queue` / `reconcile_tasks` tools, rubber-stamp down-weighting,
allowlist parse). Where a capability-probe test anchors on a proposed tool/column
name, that name is the proposed contract — keep it or update the test's anchor
and its manifest entry together (the bijection test enforces the pairing). As you
implement, flip each manifest entry's `expectation` from `pending` to `pass-now`
(and `milestone` to `shipped`) so the burn-down stays honest.
