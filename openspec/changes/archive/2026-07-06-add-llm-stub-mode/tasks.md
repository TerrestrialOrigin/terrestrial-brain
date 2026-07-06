## 1. FakeAiProvider implementation

- [x] 1.1 Add `supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts` implementing `AiProvider`.
- [x] 1.2 Implement `getEmbedding`: lowercase → word tokens → FNV-1a hash each token into `[0,1536)` buckets, accumulate weights, L2-normalize; return a 1536-length vector. Handle empty text without throwing.
- [x] 1.3 Implement `completeJson` with a system-prompt substring dispatch table covering all eight purposes (metadata, note-split, reconcile, task→project, task-enrich, project-name-from-path, project-by-content, people-detect); derive extractor/people/project matches from the request content against the supplied known-entity lists; return a benign `{}` for unrecognized prompts.
- [x] 1.4 Wire selection in `ai/factory.ts`: `TB_AI_PROVIDER === "fake"` → `new FakeAiProvider()`, else `new OpenRouterAiProvider()`.

## 2. Fake-provider unit tests (pin the fake)

- [x] 2.1 Add `tests/unit/fake-provider.test.ts`: embedding determinism (same text → identical vector, 1536 dims, unit length), empty-text case.
- [x] 2.2 Similarity monotonicity: cosine(stored, overlapping query) > cosine(stored, unrelated); self-similarity ≈ 1.0.
- [x] 2.3 `completeJson` shape test for every dispatch branch, including the known-entity echo behavior and the unknown-prompt safe default.
- [x] 2.4 Factory selection test: `TB_AI_PROVIDER=fake` → `FakeAiProvider`; other/unset → `OpenRouterAiProvider`.

## 3. Test-stack env & de-hedging

- [x] 3.1 Set `TB_AI_PROVIDER=fake` in the test stack env surface (`supabase/functions/.env`) so the running edge function selects the fake.
- [x] 3.2 Remove the hedged conditionals in `tests/integration/thoughts.test.ts` (the `if (!result.includes("No thoughts found"))` / `if (result === "No thoughts found.")` guards) and replace with hard assertions against the fake; tune search `threshold` values as needed.
- [x] 3.3 Remove the "LLM may or may not be available" structure-only hedge in `tests/integration/extractors.test.ts` and replace with a hard assertion.
- [x] 3.4 Grep-verify zero remaining LLM-availability hedges in the suite.

## 4. Live-LLM opt-in tier

- [x] 4.1 Create `tests/live/` with a minimal live smoke test (real embedding + completion well-formedness) that requires the real provider.
- [x] 4.2 Add `deno.json` task `test:live-llm` = `deno test --allow-net --allow-env tests/live/`; confirm it is NOT part of `deno task test`.
- [x] 4.3 Document the two tiers and the `test:live-llm` `OPENROUTER_API_KEY` requirement in `README.md`; fix any stale test-command wording.

## 5. Testing & Verification

- [x] 5.1 Run `deno task test` with `TB_AI_PROVIDER=fake` and NO `OPENROUTER_API_KEY` set — full suite green, zero skips, zero failures.
- [x] 5.2 GATE 2b: for a couple of de-hedged tests, confirm deleting the targeted implementation line reddens them.
- [x] 5.3 Run the plugin suite (`cd obsidian-plugin && npm test && npm run build`) — unchanged and green.
- [x] 5.4 `/opsx:verify`, then `/opsx:archive`; check off Step 22 in `codeEval/Fable20260704-fix-plan.md`.
