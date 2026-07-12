## 1. Harness scaffolding & shared helpers

- [x] 1.1 Create `tests/integration/lifecycle/_embedding.ts`: import the production `FakeAiProvider`, expose `cosineDistance(a, b)` and `embedDistance(textA, textB)` plus `assertInDedupBand` / `assertOutsideDedupBand` (band 0.05–0.10 cosine distance) so dedup fixtures assert their own precondition (design D4).
- [x] 1.2 Create `tests/integration/lifecycle/_pending.ts`: a `pending(milestone, slug, detail)` helper returning the `PENDING(<milestone>:<slug>) <detail>` reason string, and a `pendingName(base, milestone, slug)` helper for test names, so every red-by-design test carries one documented reason (design D2).
- [x] 1.3 Create `tests/sync-rules/_sync-seam.ts`: the single `syncConnector` seam that raises `PENDING(v1.5:connectors-unimplemented)` today; all sync tests route their actor-invocation through it (design D6).
- [x] 1.4 Add `deno.json` tasks: `test:eval` (real provider, `tests/eval/`) and `test:sync-rules` (`tests/sync-rules/`). Leave `test` gluing `tests/unit/ tests/integration/` (which now includes `tests/integration/lifecycle/`).

## 2. Deterministic memory-lifecycle tests (gated, mostly red-by-design)

- [x] 2.1 `actor_model.test.ts` — 3 `test` scenarios: console edit flows through the same rules as an LLM edit; consent-gated outcome renders per actor but is the same rule; no unauthorized direct-write surface exists (design D8; red-by-design `PENDING(step7:actor-model)`).
- [x] 2.2 `dedup_gate.test.ts` — 4 `test` scenarios: byte-identical capture blocked; within-note restatement dropped; cross-context near-dup surfaced as supersession candidate; distinct-outside-band written normally. Each asserts its embedding-band precondition via `_embedding.ts` first (design D2/D4; `PENDING(step7:dedup-gate)`).
- [x] 2.3 `extraction_type_allowlist.test.ts` — 3 `test` scenarios driven at the real `extractMetadata` seam with the injectable unit `FakeAiProvider`: allowed type stored as-is (pass-now for an allowlisted value); out-of-allowlist type coerced to `observation` and logged (red-by-design); missing/unparseable metadata degrades to `observation`/`["uncategorized"]` (design D5; `PENDING(step7:type-allowlist)`).
- [x] 2.4 `supersession.test.ts` — 3 `test` scenarios: recorded supersession removes older from default search; supersession never deletes history; recording a supersession re-embeds surviving content (`PENDING(step7:supersession)`).
- [x] 2.5 `usefulness_reinforcement.test.ts` — 3 `test` scenarios: selective record increments more than a rubber-stamp (red-by-design `PENDING(step7:rubber-stamp)`); `get_thought_by_id` auto-records server-side (**pass-now**); user/sync edits do not reinforce usefulness (red-by-design `PENDING(step7:actor-model)`).
- [x] 2.6 `temporal_staleness.test.ts` — 3 `test` scenarios: retrieval updates the recency signal (`last_retrieved_at`, red-by-design); score-zero alone never marks stale; stale-review queue exposed via an MCP tool (`PENDING(step7:staleness)`).
- [x] 2.7 `archival.test.ts` — 3 `test` scenarios: archival conjunction gates the queue; synced-note-owned thought never auto-queued; archiving a queued item is a consented state transition (`PENDING(step7:archival)`).
- [x] 2.8 `task_reconciliation.test.ts` — 2 `test` scenarios: reconciliation asks before closing; declining leaves the task open (`PENDING(step7:reconciliation)`).
- [x] 2.9 `invariant1_reembed_rehash.test.ts` — 4 `test` scenarios: edited content found by its new wording (**pass-now** for thoughts via `update_thought`); stored hash equals hash of new content (red-by-design, `content_hash` unbuilt); guarantee holds for projects/tasks/documents (red-by-design); emptying content is a valid re-hashed edit (design D8; `PENDING(step7:content-hash)` / `PENDING(step7:invariant1-entities)`).

## 3. Eval tier (opt-in, scored, thresholded)

- [x] 3.1 Create `tests/eval/_harness.ts`: a `scoreScenario(name, cases, runCase, threshold)` runner that computes a pass-rate over labeled cases and asserts `>= threshold` (default 0.8, documented), fail-loud without `OPENROUTER_API_KEY` (design D7).
- [x] 3.2 `tests/eval/memory_evals.test.ts` — the 4 memory `eval` scenarios: keep-vs-merge at the margin; right type on ambiguous content; detects a genuine contradiction (not elaborations); sweep identifies done-looking tasks. Each with a small labeled fixture set + threshold.
- [x] 3.3 `tests/eval/sync_evals.test.ts` — the 1 sync `eval` scenario: conversation-born task offered to the PMS (ask-first phrasing).

## 4. Sync-rules tier (opt-in behind the v1.5 seam, never skipped)

- [x] 4.1 `tests/sync-rules/pms_ingest.test.ts` — 4 `test` scenarios: new PMS item creates a TB task with external ref; native status category used not board columns; upstream completion of a known task marks it done; upstream completion of an unknown item ignored.
- [x] 4.2 `tests/sync-rules/status_ownership.test.ts` — 3 `test` scenarios: PMS-origin status follows upstream; locally-born task fully TB-owned; TB never writes upstream unprompted.
- [x] 4.3 `tests/sync-rules/consented_close.test.ts` — 4 `test` scenarios: consent-yes closes both on success; upstream failure keeps TB task open; decline keeps TB task open; only consent triggers upstream creation.
- [x] 4.4 `tests/sync-rules/webhook_idempotency.test.ts` — 3 `test` scenarios: duplicate delivery no double-ingest; trivial-edit below the change gate ignored; reconciliation sweep recovers a missed event. All route through the `syncConnector` seam and fail with `PENDING(v1.5:connectors-unimplemented)`.

## 5. Coverage manifest & bijection meta-test

- [x] 5.1 Create `tests/lifecycle-coverage.manifest.ts`: one entry per Step 5 scenario `{ capability, requirement, scenario, tag, tier, milestone, expectation, testRef }` (all 47).
- [x] 5.2 Create `tests/unit/lifecycle-coverage.test.ts`: parse both spec files' `#### Scenario:` headings + `Tag:`, assert a bijection with the manifest (uncovered/stale/renamed → fail), and log the burn-down (`pass-now` / `pending step7` / `pending v1.5`). This test must be **green** (design D3).

## 6. CI, ThreatModel, docs

- [x] 6.1 `.github/workflows/ci.yml`: keep `deno task test` as the deterministic tier (documented red-by-design until Step 7); make `deno lint` and `deno fmt --check` run with `if: always()` so those signals survive the intentional red; add a comment block explaining the red-by-design state + burn-down and that `test:eval`/`test:sync-rules` are opt-in.
- [x] 6.2 `ThreatModel.md`: add T21 (vacuous-green harness), T22 (dishonest red), T23 (silent coverage gap) with mitigations (design Security analysis).
- [x] 6.3 Update `openspec/specs`-adjacent docs / `deno.json` task docs as needed so the tiers (`test`, `test:eval`, `test:sync-rules`) and the red-by-design contract are documented for the next agent (Step 7).

## 7. Testing & Verification

- [x] 7.1 Start the local stack the human way (`npx supabase start`, edge env `TB_AI_PROVIDER=fake`, `MCP_ACCESS_KEY=dev-test-key-123`); deploy/serve the function as the suite expects.
- [x] 7.2 Run `deno task test`. Confirm: the pass-now tests (auto-record, INVARIANT-1-on-thoughts edited-found, allowlisted-type-as-is, coverage meta-test) are GREEN; every other lifecycle test is RED with its documented `PENDING(step7:...)` reason (no crashes/500s/unknown-tool-for-existing-surface). Capture the red/green breakdown as the burn-down evidence.
- [x] 7.3 GATE-2b mutation spot-check: temporarily remove the shipped INVARIANT-1-on-thoughts re-embed line and the auto-record line, confirm the corresponding pass-now tests go RED, then restore. Record the result.
- [x] 7.4 Run `deno task test:sync-rules`: confirm all 14 sync tests execute and fail with `PENDING(v1.5:connectors-unimplemented)` (never skipped).
- [x] 7.5 Run `deno task test:eval` with no key: confirm fail-loud `OPENROUTER_API_KEY` error (never a skip / green). (A keyed run is opt-in and not required here.)
- [x] 7.6 `deno lint` and `deno fmt --check` clean over the new files; grep the lifecycle/sync/eval trees for `.skip` / `ignore: true` and confirm none.
- [x] 7.7 Obsidian plugin unaffected: `cd obsidian-plugin && npm test && npm run build` green (regression guard — no plugin changes in this step).
- [x] 7.8 `openspec validate lifecycle-rules-test-harness --strict` clean; run `/opsx:verify`.
