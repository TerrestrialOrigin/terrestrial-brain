## 1. Provider module (the seam)

- [x] 1.1 Create `ai/ai-provider.ts`: the `AiProvider` interface (`getEmbedding`, `completeJson<Parsed>`), the `AiJsonCompletionRequest` type, and the typed errors `AiProviderHttpError` (status + truncated body) and `AiProviderParseError`.
- [x] 1.2 Create `ai/openrouter-provider.ts`: `OpenRouterAiProvider` implementing the interface — private `OPENROUTER_BASE` constant, `CHAT_MODEL`/`EMBEDDING_MODEL` named constants, lazy `requireEnv("OPENROUTER_API_KEY")` per call, `response.ok` handling that throws `AiProviderHttpError`, JSON parse that throws `AiProviderParseError`, key only in `Authorization` header.
- [x] 1.3 Create `ai/factory.ts`: `createAiProvider(): AiProvider` returning `new OpenRouterAiProvider()` (single place Step 22 will branch on `TB_AI_PROVIDER`).
- [x] 1.4 Add `ai/openrouter-provider.test.ts` (unit, stubbed `fetch` restored in `finally`): 200 → parsed value; non-OK → `AiProviderHttpError` with status; non-JSON body → `AiProviderParseError`; `getEmbedding` returns vector and throws on non-OK. Confirm each fails if the corresponding provider branch is removed.

## 2. Compose & inject at the root

- [x] 2.1 `index.ts`: construct `const aiProvider = createAiProvider()` at module scope; pass it into `createMcpServer(supabase, logger, aiProvider)`.
- [x] 2.2 `index.ts` `createMcpServer`: add `aiProvider` param and forward it into every `register(server, supabaseClient, callLogger, aiProvider)` call.
- [x] 2.3 Update each tool module's `register(...)` signature (`thoughts`, `projects`, `tasks`, `ai_output`, `queries`, `people`, `documents`) to accept `aiProvider: AiProvider` (add even where currently unused, to keep the composition uniform) — or thread only where consumed, per what compiles cleanly; keep it consistent and documented.

## 3. Pipeline & extractor injection

- [x] 3.1 `extractors/pipeline.ts`: add `aiProvider: AiProvider` to `ExtractionContext`; change `runExtractionPipeline` to accept `aiProvider` and set it on the built context.
- [x] 3.2 Update the 4 `runExtractionPipeline(...)` call sites (`tools/documents.ts` ×2, `tools/thoughts.ts` ×2) to pass the injected `aiProvider`.
- [x] 3.3 `extractors/people-extractor.ts`: replace the `detectAllPeople` fetch block with `context.aiProvider.completeJson`, moving the existing parse/`validIds` filter into the `parse` callback; keep the `!ok`/throw → `[]` fallback; remove the module-level `OPENROUTER_BASE` and `requireEnv` import.
- [x] 3.4 `extractors/project-extractor.ts`: replace both fetch blocks (`extractProjectNameFromPath`, `detectProjectsByContent`) with `completeJson`; preserve their `{isProject:false}` / `[]` fallbacks and `validIds` filtering; thread `aiProvider` from `extract` into these helpers; remove module-level LLM constants.
- [x] 3.5 `extractors/task-extractor.ts`: replace both fetch blocks (`inferProjectsByContent`, `inferTaskEnrichments`) with `completeJson`; preserve the `{ok:false}` vs `{ok:true, []}` distinction via catch-vs-parse; thread `aiProvider`; remove module-level LLM constants.

## 4. helpers.ts & thoughts.ts call sites

- [x] 4.1 `helpers.ts`: give `getEmbedding`, `extractMetadata`, `freshIngest` an `aiProvider` parameter; reimplement each over the provider preserving its exact fallback (embedding throws; metadata warns+uncategorized; split throws on `!ok`, single-thought on parse-fail); `freshIngest` forwards the provider into its inner embedding/metadata calls; remove `OPENROUTER_BASE`.
- [x] 4.2 `tools/thoughts.ts`: thread the `aiProvider` (from `register`) into every `getEmbedding`/`extractMetadata`/`freshIngest` call and into `runExtractionPipeline`; replace the reconcile fetch block with `completeJson` preserving throw-on-`!ok` and parse-fail→fresh-ingest fallback; remove the module-level `OPENROUTER_BASE`.

## 5. Seam demonstration test

- [x] 5.1 Convert one extractor unit test (`extractors/project-extractor` content matching) to construct a hand-written `FakeAiProvider` and assert deterministic behavior with no network; confirm removing the `completeJson` call reddens it (GATE 2b).

## 6. Verification

- [x] 6.1 `grep -rn "openrouter.ai" supabase/functions` returns exactly one hit (the provider impl); `grep -rn "OPENROUTER_BASE\|/chat/completions\|/embeddings" tools/ extractors/ helpers.ts` returns nothing outside `ai/`.
- [x] 6.2 `deno check` clean on the function; `deno lint` clean.
- [x] 6.3 Full Deno integration suite green with **no test edits** to existing files (pure-refactor safety net) + the new provider/seam unit tests; plugin suite unaffected (`cd obsidian-plugin && npm test && npm run build`).
- [ ] 6.4 `/opsx:verify`, then update the fix-plan Step 15 checkbox, commit, open PR to `develop`.
