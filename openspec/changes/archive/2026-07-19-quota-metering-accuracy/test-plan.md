# Test Plan — quota-metering-accuracy (Phase C remainder: Steps 19+20)

All bug scenarios were replicated RED-first (8 failing tests before the fixes), then fixed GREEN.

| Spec scenario | Layer | Test | RED-first |
|---|---|---|---|
| Errored/refused rows not counted (meter chain) | Unit | `ai-quota.test.ts` "meter excludes errored/refused rows" | ✓ |
| Refusal doesn't reduce remaining allowance (real DB) | Integration | `managed-ai-metering.test.ts` "refused/errored call does not reduce…" | ✓ |
| Month rollover via injected clock | Unit | `ai-quota.test.ts` "withAiQuota: month rollover…" | new seam |
| Route uses injected clock | Unit | `http-routes.test.ts` deps carry `now` (compile-enforced; 429 path covered) | seam |
| Exact-part assignment beats containment | Unit | `extractor-helpers.test.ts` EXTR-3 pair | ✓ |
| Ambiguous assignment falls through | Unit | same | ✓ |
| Absent enrichment entry preserves stored fields | Unit | `task-extractor-merge.test.ts` "omitted from the enrichment response…" | ✓ |
| Present-with-nulls clears (control) | Unit | existing test 1.4 (unchanged) | — |
| Null element tolerated: enrichments / assignments / people | Unit | merge suite ×2 + `people-extractor.test.ts` | ✓ ×3 |
| "Ann Smith" beats "Ann" both orders | Unit | `name-matching.test.ts` | ✓ |

Mock audit: fakes only on meter/clock/repository/fetch seams; gate, meter query, dispatcher, extractors, and matchers under test are real. Integration layer = real modules against the real stack. Full gates: `scripts/validate-all.sh` (pgTAP + full Deno suite + lint + fmt + plugin tests + build).
