## Why

Every call to OpenRouter (embeddings + chat/JSON completion) is a hand-copied
`fetch` block: the same base URL constant, headers, `response.ok` check, and
JSON parse/validate/fallback shape appear **8 times** across `helpers.ts`,
`thoughts.ts`, and the three extractors (finding X1). There is no seam over the
LLM (finding X2), so nothing that calls OpenRouter can be unit-tested without a
live, paid API key — and the deterministic-stub work (fix-plan Step 22) is
impossible until this seam exists. This change introduces the single
`AiProvider` abstraction the rest of the plan depends on.

## What Changes

- Introduce an `AiProvider` interface (`getEmbedding`, `completeJson`) as the one
  narrow seam over OpenRouter, plus a single `OpenRouterAiProvider`
  implementation that owns the base URL, model names (named constants), lazy
  `requireEnv("OPENROUTER_API_KEY")` read, `response.ok` handling, and JSON
  parse/validate/fallback.
- Replace all 8 inline OpenRouter `fetch` blocks with calls to the injected
  provider: `helpers.getEmbedding` / `extractMetadata` / `freshIngest` (split),
  `people-extractor.detectAllPeople`, `project-extractor` (path analysis +
  content matching), `task-extractor` (project inference + task enrichment), and
  the `thoughts.ts` reconcile call.
- Inject the provider as a real dependency: added to `ExtractionContext` and to
  every tool module's `register(...)` signature, threaded from the `index.ts`
  composition root. No module-level env reads, no hidden singletons — this is the
  seam Step 22's `FakeAiProvider` plugs into.
- Add a `createAiProvider()` factory at the composition root so Step 22 can later
  select a fake implementation via env, without touching call sites.

This is a **pure refactor**: zero behavior change is intended. Each call site
keeps its existing fallback semantics (throw vs. degrade-to-default); only the
transport moves behind the interface. The integration suite is the safety net.

## Capabilities

### New Capabilities
- `ai-provider`: The `AiProvider` seam over external LLM/embedding calls — its
  interface contract (`getEmbedding`, `completeJson`), the single
  `OpenRouterAiProvider` implementation, and the requirement that it be injected
  (never imported as a module-level singleton) so a fake can be substituted in
  tests.

### Modified Capabilities
- `extractor-pipeline`: `ExtractionContext` now carries an injected `aiProvider`;
  extractors obtain the LLM through the context rather than importing env and
  constructing `fetch` calls themselves. `runExtractionPipeline` accepts and
  forwards the provider.

## Impact

- **Code:** new `ai/` module (`ai-provider.ts` interface + `openrouter-provider.ts`
  impl + `factory.ts`); `helpers.ts`, `tools/thoughts.ts`, `tools/documents.ts`,
  `extractors/{pipeline,people-extractor,project-extractor,task-extractor}.ts`,
  and `index.ts` are rewired to receive/forward the provider. Every tool
  module's `register(...)` gains an `aiProvider` parameter.
- **Specs:** new `openspec/specs/ai-provider/`; modified
  `openspec/specs/extractor-pipeline/`.
- **Tests:** extractor unit tests gain the ability to pass a `FakeAiProvider`
  (one converted test demonstrates the seam); existing integration suite must
  stay green untouched.
- **Dependencies / config:** no new npm/deno deps; no new env vars in this step
  (`TB_AI_PROVIDER` selection lands in Step 22).
