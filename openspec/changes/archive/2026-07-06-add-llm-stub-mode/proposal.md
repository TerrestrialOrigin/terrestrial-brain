## Why

The test suite runs embeddings and extraction through the live, paid, nondeterministic OpenRouter API (finding X6). A green run costs money, can flake on model behavior, and is impossible in CI without a secret key. Worse, several tests hedge around LLM unavailability with `if (!result.includes("No thoughts found"))` guards — **skips wearing a "passed" badge** that pass whether or not the behavior under test actually works, violating the zero-skip rule and failing the GATE 2b mutation check. The `AiProvider` seam (Step 15) exists precisely so a deterministic fake can be dropped in; this change plugs it in.

## What Changes

- Add a `FakeAiProvider` implementation of the existing `AiProvider` interface in the MCP edge function, selected at the `createAiProvider()` factory by the env var `TB_AI_PROVIDER=fake`. Default behavior (unset / any other value) stays `OpenRouterAiProvider`, so production is unchanged.
- `FakeAiProvider.getEmbedding` produces **deterministic, seeded, content-derived** vectors whose cosine similarity is stable — near-identical for identical/overlapping text and low for unrelated text — so vector search (`search_thoughts`) is reproducible and a captured thought is findable by a related query with NO live API.
- `FakeAiProvider.completeJson` returns **deterministic, content-derived** responses sufficient for every current caller: metadata extraction (`extractMetadata`), the ingest reconciliation plan, and the task / project / people extractors. Each response is shaped by the caller's `parse` callback exactly as the real provider's is.
- DELETE every hedged assertion in the suite — the `if (!result.includes("No thoughts found"))` / `if (result === "No thoughts found.")` guards in `tests/integration/thoughts.test.ts` and the "LLM may or may not be available" structure-only assertions in `tests/integration/extractors.test.ts` — replacing them with **hard** assertions that run against the fake (GATE 2b: deleting the matching implementation line must redden them).
- Add a `deno.json` task `test:live-llm` that runs a small, explicitly-invoked live-LLM tier against the real OpenRouter provider. This is an opt-in extra tier, **NOT** a skip in the default suite.
- Configure the local test stack to run with `TB_AI_PROVIDER=fake` so the default suite passes with **no** `OPENROUTER_API_KEY` set, and document the two tiers and the live-tier key requirement in `README.md`.

## Non-goals

- Not touching the `OpenRouterAiProvider` implementation or its transport behavior — production keeps calling the real API.
- Not building CI (`.github/` workflows) — that is Step 23; this change only makes the suite deterministic and key-free so CI becomes possible.
- Not changing the `AiProvider` interface signature — the fake implements the existing two-method contract as-is.
- Not attempting to make fake embeddings semantically "smart" beyond stable, content-overlap-driven similarity sufficient for the suite's search assertions.

## Capabilities

### New Capabilities
- None. The stub plugs into existing seams.

### Modified Capabilities
- `ai-provider` (`openspec/specs/ai-provider/spec.md`): the provider is now selectable between a live implementation and a deterministic fake via `TB_AI_PROVIDER`; the fake's determinism and similarity guarantees become part of the contract.
- `test-infrastructure` (`openspec/specs/test-infrastructure/spec.md`): the default suite SHALL run deterministically with no live LLM key and contain no hedged LLM-availability conditionals; a separate opt-in live-LLM tier is defined.

## Impact

- Code: new `supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts`; `ai/factory.ts` gains the `TB_AI_PROVIDER` branch.
- Tests: `tests/integration/thoughts.test.ts`, `tests/integration/extractors.test.ts` lose their hedged conditionals; possibly a small `tests/live/` tier for the opt-in task.
- Config/docs: `deno.json` (`test:live-llm` task), test-stack env (`supabase/functions/.env` / start scripts to set `TB_AI_PROVIDER=fake`), `README.md` (two-tier testing + key requirement).
- No migration, no plugin change, no production behavior change.
