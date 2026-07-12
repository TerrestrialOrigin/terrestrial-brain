## 1. Author the lifecycle rules delta spec

- [x] 1.1 Write `specs/memory-lifecycle-rules/spec.md` with the actor-model, dedup, extraction-type,
  supersession, usefulness/rubber-stamp, staleness, archival, task-reconciliation, and
  re-embed/re-hash (INVARIANT 1) requirements — every scenario tagged `test`/`eval` and mutations
  tagged with an actor
- [x] 1.2 Verify each requirement has ≥1 scenario and the design-bias (minimize `eval`, prefer
  server-side `test`) is reflected — deterministic outcomes are `test`, only model-judgment is `eval`

## 2. Author the integration sync rules delta spec

- [x] 2.1 Write `specs/integration-sync-rules/spec.md` (PMS→TB ingest, single-owner/status
  precedence, no autonomous push, consented close, ask-first creation, webhook idempotency) as
  `actor: sync`, specced now / implemented v1.5+
- [x] 2.2 Confirm the sync rules reference the shared actor model and do not introduce a parallel
  ruleset

## 3. Record decisions and threats

- [x] 3.1 Capture the three Step-4 handoff decisions in `design.md` with rationale: dedup band
  (0.05–0.10), `type` allowlist (extend with `instruction`/`decision` + `observation` fallback),
  rubber-stamp down-weighting
- [x] 3.2 Add the lifecycle spec-integrity threats (T-lifecycle-1..5) to `ThreatModel.md`
- [x] 3.3 Record the user-error scenarios and the test-vs-eval strategy in `design.md`

## 4. Testing & Verification

- [x] 4.1 `openspec validate memory-lifecycle-rules-spec --strict` passes
- [x] 4.2 Backend suite green on the local stack (`npx supabase start`, `TB_AI_PROVIDER=fake`,
  `deno task test`) — spec-only change must not regress anything; zero failures, zero skips
- [x] 4.3 Plugin suite + build green (`cd obsidian-plugin && npm test && npm run build`)
- [x] 4.4 Mark New-Feature-Plan Step 5 complete in `codeEval/Fable20260710-NewFeaturePlan.md`
- [x] 4.5 `/opsx:verify` then `/opsx:archive`
