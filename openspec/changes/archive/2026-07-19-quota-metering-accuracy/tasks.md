# Tasks — quota-metering-accuracy (Phase C remainder: Steps 19+20)

## 1. Step 19 — Quota metering accuracy

- [x] 1.1 RED: unit meter-chain test (`is(error_details, null)`) + integration refused-call-not-counted test
- [x] 1.2 Fix: meter excludes errored rows; gate doc documents the residual concurrency window (CORE-9)
- [x] 1.3 Clock seam: `withAiQuota(gate, handler, now = Date.now)`; `HttpRouteDeps.now`; rollover unit test (CORE-13)

## 2. Step 20 — Extractor enrichment & merge

- [x] 2.1 RED: EXTR-3 (containment mis-assignment, ambiguity), EXTR-4 (absent entry clears), EXTR-8 (null element poisons batch ×3), EXTR-10 (list-order tie-break) — 7 failing tests confirmed
- [x] 2.2 Fix EXTR-3: `extractAssignment` → `findPersonByName`
- [x] 2.3 Fix EXTR-4: `applyAiEnrichment` reports responded indexes; absent entry → preserve
- [x] 2.4 Fix EXTR-8: `isRecord` guards in all five parse callbacks (shared guard in pipeline.ts)
- [x] 2.5 Fix EXTR-10: equal-position tie prefers longer name

## 3. Testing & Verification

- [x] 3.1 `npx supabase db reset` + full `deno task test` — zero failures, zero skips (via validate-all)
- [x] 3.2 `cd obsidian-plugin && npm test && npm run build` — green (via validate-all)
- [x] 3.3 `scripts/validate-all.sh` — green
- [x] 3.4 Walk delta-spec scenarios; docs check
