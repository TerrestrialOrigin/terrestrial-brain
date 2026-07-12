## Context

Step 5 (`memory-lifecycle-rules-spec`, archived) produced two capability specs —
`memory-lifecycle-rules` and `integration-sync-rules` — with ~50 GIVEN/WHEN/THEN scenarios, each
tagged `test` (deterministic) or `eval` (LLM-behavior). They are acceptance criteria with no
executable enforcement. Step 7 will build the memory-hygiene features (write-time dedup gate,
supersession edge, staleness/archival queues, task reconciliation, actor model, extraction-`type`
allowlist coercion, INVARIANT-1 re-embed/re-hash extended to projects/tasks/documents). The plan
mandates **TDD at phase scale**: this step writes the tests first; Step 7 turns them green.

**Grounding — what already ships today** (from the Step-4 audit and a fresh code map; the tests for
these are written to **pass now**, proving the harness runs against real behavior, not vapor):
- `get_thought_by_id` auto-increments usefulness server-side (`tools/thoughts.ts:523-529`).
- `update_thought` re-embeds + re-writes metadata when `content` changes (`tools/thoughts.ts:93-116`).
- `record_useful_thoughts` → atomic server-side `increment_usefulness` RPC
  (`repositories/supabase-thought-repository.ts:197-202`).
- `function_call_logs.returned_ids` + `records_returned` via the `ResultMeta` seam
  (`mcp-response.ts:13-18`, `logger.ts:116-153,192-216`) — the retrieval-recency precursor.

**What does NOT exist yet** (every test for these is **red-by-design** until Step 7): the dedup gate
(`capture_thought` inserts unconditionally), `supersedes` edge, `content_hash`, `last_retrieved_at`,
staleness/archival review-queue tools, task-reconciliation sweep, the `actor` column, rubber-stamp
down-weighting, and extraction-`type` allowlist coercion (`helpers.ts:56` casts `raw as …`, no
`THOUGHT_TYPES` check). **The integration-sync connectors do not exist at all** and are a **v1.5**
horizon, not Step 7.

**Test infrastructure this harness reuses** (per `test-infrastructure` spec): integration tests hit
the **real local Supabase stack** over HTTP through `tests/helpers/mcp-client.ts`
(`callTool`/`callToolRaw`/`callHTTP`, service-role REST for side-effect assertions, `uniqueName`
fixtures, `try/finally` cleanup); the running edge function uses the process-global deterministic
`FakeAiProvider` (`ai/fake-provider.ts`) selected by `TB_AI_PROVIDER=fake`, whose `getEmbedding` is
a pure content-derived unit vector (identical text → identical vector; cosine rises with word
overlap). The opt-in real-LLM tier model is `tests/live/live-llm.test.ts` + `deno task test:live-llm`.

## Goals / Non-Goals

**Goals:**
- One executable harness entry for **every** Step 5 scenario, traceable via a coverage manifest
  (no scenario silently uncovered).
- Deterministic (`test`-tagged) scenarios → real integration tests on the local stack, **no mocks on
  the tested path** (the LLM boundary is the only permitted seam), living in the gated `deno task
  test` per the user's explicit "literal TDD-at-phase-scale" decision.
- Every red-by-design test fails for exactly **one documented reason** (named feature absent),
  making a red-by-design failure trivially distinguishable from a broken test; the RED-first
  discipline is verified per scenario during `/opsx:apply`.
- Eval (`eval`-tagged) scenarios → a scored, thresholded, opt-in harness (`deno task test:eval`),
  real provider, guarded by `OPENROUTER_API_KEY`, **never a silent skip**.
- CI runs the deterministic tier (documented red-by-design with a burn-down count) and keeps
  lint/fmt signal alive; the eval tier is opt-in.
- No production code, schema, migration, or data change.

**Non-Goals:**
- Implementing any hygiene feature or connector (Step 7 / v1.5).
- Modifying `supabase/functions/**` (including the fake provider) — the harness drives the LLM seam
  with the existing **injectable** unit fake (`tests/unit/fakes/extraction-fakes.ts`), never by
  editing production fakes to make a test pass.
- Tuning the exact dedup number or down-weighting curve (Step 7 `design` constants).
- Building the memory console or wiring a real PMS.

## Decisions

### D1 — Two verification tiers; deterministic scenarios ride the gated suite (red-by-design)
Per the user's explicit decision, `test`-tagged scenarios become real integration tests under
`tests/integration/lifecycle/` and are collected by the existing `deno task test`. Most are
red-by-design and stay red until Step 7 implements the feature (INVARIANT-1-on-thoughts,
auto-record, usefulness increment, and `returned_ids`/`records_returned` are the exceptions — written
to **pass now**). `eval`-tagged scenarios run in a separate opt-in `deno task test:eval` against the
real provider. **Why:** the plan's TDD-at-phase-scale intent is that Step 7 has a concrete failing
target; the user accepted a red default gate for the Step-7 horizon. *Alternative rejected (offered
and declined):* a separate non-gated `test:lifecycle` tier that keeps the default suite green — the
user chose the literal gated form.

### D2 — Red-by-design honesty: one documented failure reason per pending scenario
Each red-by-design test asserts the **target** Step-7 behavior and is written so its **only** current
failure mode is the missing feature. Each carries a `PENDING(<milestone>:<feature-slug>)` marker in
its test name and a matching human reason in the decisive assertion message (e.g.
`PENDING(step7:dedup-gate) expected 1 active row after identical capture, got 2`). During
`/opsx:apply` each pending test is run and its RED output is confirmed to be the documented reason —
not a 500, a connection error, an unknown-tool error where a tool *should* exist, or a typo. **Why:**
the CLAUDE.md GATE-2b discipline ("watch it fail RED for the expected reason") applied at phase
scale; it is the only thing that keeps a red suite meaningful rather than noise. *Alternative
rejected:* `t.step`/`ignore`/`describe.skip` — forbidden (silent skips) and they hide the burn-down.

### D3 — The coverage manifest is the source of truth and is itself tested
`tests/lifecycle-coverage.manifest.ts` enumerates every Step 5 scenario as
`{ capability, requirement, scenario, tag, tier, milestone, expectation: "pass-now" | "pending", testRef }`.
A meta-test parses both spec files, extracts every `#### Scenario:` heading with its `Tag:`, and
asserts a bijection with the manifest — a new or renamed scenario with no harness entry **fails the
build**. The manifest also renders the burn-down (`N pending step7`, `M pending v1.5`, `K passing
now`). **Why:** "tests for every scenario" is only credible if a machine checks completeness; it also
gives Step 7 an exact checklist and prevents spec drift. *Alternative rejected:* a hand-maintained
checklist — drifts silently, the exact failure mode this product exists to cure.

### D4 — Dedup-band fixtures are computed from the real fake embedding, not guessed
Dedup `test` scenarios need fixtures at known cosine distances. The harness imports the production
`FakeAiProvider` and computes `getEmbedding` distances in a `tests/integration/lifecycle/_embedding.ts`
helper to **assert each fixture's precondition** (byte-identical → distance 0 → inside the 0.05–0.10
band; a single-token restatement → inside band; disjoint-vocabulary content → distance ≈ 1 → well
outside). So a fixture that drifts out of its intended band fails its own precondition assertion
rather than silently invalidating the dedup test Step 7 must satisfy. **Why:** the fixtures are the
contract Step 7 calibrates against; they must be provably in-band under the deterministic embedding.
*Alternative rejected:* hard-coded prose fixtures with assumed distances — brittle and unfalsifiable.

### D5 — Extraction-`type` allowlist is driven at the `extractMetadata` seam with the injectable fake
The process-global server fake always emits `type: "observation"`, so a bad type cannot be pushed
through the HTTP path without editing production code (a Non-Goal). Instead the allowlist `test`
scenarios import the real `extractMetadata` and inject the **unit** `FakeAiProvider`
(`extraction-fakes.ts`, constructor `rawFor`) returning `type: "sentiment"` / `type: "decision"` /
malformed output, then assert the parsed result. The **AiProvider is the only mock**, and it sits on
the legitimate external-LLM boundary; the parse/validate/coerce code under test is real. These are
red-by-design (today `helpers.ts:56` casts, so `sentiment` survives). **Why:** honours "no mocks on
the tested path" (the path is the parse gate; the LLM is a seam) while still being deterministic.
*Alternative rejected:* teaching the server fake a `__FAKE_TYPE__` backdoor — edits production code
to test, and leaks a test affordance into the shipped fake.

### D6 — Integration-sync tests are executable now but gated behind a v1.5 seam, not the default suite
No connector surface exists and none is built until v1.5, so gating `deno task test` on sync
scenarios would keep the default suite red for **many releases past Step 7** with no burn-down path —
defeating D2's "Step 7 drives it green." The sync `test` scenarios are written with full
fixtures/assertions but route their actor-invocation through a single `syncConnector` seam
(`tests/integration/lifecycle/_sync-seam.ts`) that currently throws
`PENDING(v1.5:connectors-unimplemented)`; they run under an explicit opt-in `deno task test:sync-rules`,
are listed in the manifest with `milestone: v1.5`, and are **never skipped**. v1.5 wires the seam to
the real connector and the whole tier flips red→green at one point. **Why:** keeps every sync
scenario executable and tracked without making the Step-7 burn-down permanently unreachable. This is
the one deliberate divergence from "every `test` scenario in `deno task test`"; it is called out
explicitly to the user, and its sole cause is the v1.5-vs-Step-7 horizon gap. *Alternative rejected:*
putting them in the gated suite — main stays red past Step 7 forever, and "green" becomes unreachable
as a completion signal for Step 7.

### D7 — Eval tier: scripted fixtures, scored pass-rate, documented threshold, fail-loud without a key
`tests/eval/**` + `deno task test:eval` (real provider, no `TB_AI_PROVIDER=fake`). Each `eval`
scenario is a labeled fixture set; the harness runs N cases, computes a pass-rate, and asserts it
`>= THRESHOLD` (documented per scenario, default 0.8 with rationale). With no `OPENROUTER_API_KEY`
the real provider throws a clear `requireEnv` error (fail-loud, exactly like the live tier) — not a
skip. The eval tier is **not** part of the green gate and **not** in the burn-down count; it reports
its own score. **Why:** LLM-judgment scenarios (contradiction detection, ambiguous-type choice,
near-dup keep/merge at the margin, reconciliation identification, ask-first phrasing) cannot be
deterministic; scoring + threshold is the honest form. Most assert the *future* model behavior against
Step-7 prompts, so they too burn down — but as a score, not a boolean.

### D8 — Actor model is asserted structurally, not via a second code path
The "single ruleset parameterized by actor" scenarios assert that a mutation made as `user` produces
the **same** side effects (re-embed/re-hash, dedup, supersession checks) as the identical `LLM`
mutation, and that no bypass write-surface exists. Until Step 7 adds the `actor` dimension these are
red-by-design; the test encodes the invariant so Step 7's console/connector work cannot fork the
ruleset without breaking it. **Why:** Invariant 2 is a structural guarantee; the test is its guard.

### Test Strategy
- **Deterministic tier (`test`):** real local stack, `TB_AI_PROVIDER=fake`, no mocks on the tested
  path except the LLM seam where a rule is *about* parsing LLM output (D5). Assert on durable DB
  state via service-role REST (row counts, `metadata.type`, edges, queue membership, stored hash),
  never on transient response prose alone. Fixtures are unique-named and cleaned in `try/finally`.
- **Eval tier (`eval`):** opt-in, scored, thresholded, fail-loud without a key (D7).
- **Coverage:** the manifest meta-test enforces scenario↔test bijection (D3).
- **Red-first verification:** every pending test's RED reason is confirmed during apply (D2); every
  pass-now test is confirmed GREEN against current code, and a mutation check (delete the shipped
  line) is spot-checked on at least the INVARIANT-1-on-thoughts and auto-record tests to prove they
  are not vacuous.
- **Design bias:** wherever a rule *could* be either tier, it is written as `test` (the Step 5
  design already pushed rules server-side to enable this); the `eval` set is minimized.

### User-error scenarios (encoded as harness tests)
- **Test author renames/adds a spec scenario but forgets the harness** → manifest bijection meta-test
  fails the build (D3).
- **A red-by-design test is actually broken** (typo, 500, wrong route) → its failure reason will not
  match its `PENDING(...)` marker; the apply-time RED-reason check catches it (D2).
- **A fixture silently drifts out of the dedup band** → its precondition assertion fails first (D4).
- **The eval tier is run with no key** → fail-loud `requireEnv`, never a green-looking skip (D7).
- **Someone deletes a shipped behavior** (regresses INVARIANT-1 on thoughts) → the pass-now test goes
  red, catching the regression (mutation-checked, D-Test-Strategy).

### Security analysis (→ `ThreatModel.md`)
This change adds no runtime surface, but the harness is a **trust anchor**: if it can go green while a
rule is unenforced, it launders unsafe behavior as safe. New notes (T21–T23):
- **T21 — Vacuous-green harness.** A test that mocks the very behavior it claims to verify (e.g.
  faking the dedup decision) would pass without the feature existing. *Mitigation:* mock-boundary rule
  enforced in review; only the LLM seam is faked; GATE-2b mutation spot-check on shipped-behavior
  tests; assertions read durable DB state, not prose.
- **T22 — Dishonest red.** A red-by-design failure masking a genuine harness bug. *Mitigation:* D2
  one-documented-reason-per-pending-test, verified RED at apply; manifest records the expected reason.
- **T23 — Silent coverage gap.** A Step 5 scenario with no executable check, giving false confidence.
  *Mitigation:* D3 manifest bijection fails the build on any uncovered/renamed scenario.
- The harness also **exercises** the Step 5 data-integrity threats (T-lifecycle-1..5) as tests, so
  when Step 7 lands, those mitigations are guarded by executable checks.

## Risks / Trade-offs

- **[Long-lived red default suite]** `deno task test` (and CI's backend job) is red from this merge
  until Step 7. → Accepted per the user's explicit choice (D1); CI reordered so lint/fmt still run
  (`if: always()`), and the burn-down count is surfaced so "how red, and why" is always legible. This
  is flagged to the user before the merge.
- **[Sync tier divergence]** Sync `test` scenarios are opt-in, not gated (D6), a deliberate deviation
  from "all in `deno task test`". → Sole cause is the v1.5 horizon; called out explicitly; still
  executable, tracked, never skipped.
- **[Fixture brittleness under a token-hash embedding]** Near-dup band fixtures depend on the fake's
  tokenizer. → D4 asserts each fixture's precondition from the real fake, so drift fails loudly and
  early; Step 7 recalibrates the numeric band against the real embedding anyway.
- **[Eval flakiness / cost]** Real-LLM eval can regress or cost tokens. → Opt-in only, thresholded
  (not exact-match), fail-loud without a key, never in CI's required path.
- **[Harness churn when Step 7 lands]** Turning red→green may require touching many tests. → The
  manifest + one-reason-per-test structure makes the burn-down mechanical and auditable; assertions
  target the specced outcome, so a correct Step 7 greens them without rewrites.

## Migration Plan

No runtime migration — test/CI code only. Deployment = merging the harness; the deterministic tier is
red-by-design until Step 7, the eval + sync tiers are opt-in. Rollback = revert the change; nothing in
production is touched. The scenarios become Step 7's executable acceptance checklist (burn red→green)
and v1.5's for the sync tier.

## Open Questions

- Exact eval pass-rate threshold per scenario (default 0.8) — confirm against a first real run in
  Step 7; specced as a documented constant here.
- Whether the sync tier should later graduate into the gated suite once v1.5 connectors exist — a
  v1.5 decision; the seam (D6) makes the move a one-line change.
