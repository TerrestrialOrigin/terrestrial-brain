/**
 * Composition-root factory for the `AiProvider` (fix-plan Step 15).
 *
 * A single place to construct the provider. Step 22 adds the `TB_AI_PROVIDER`
 * branch: the exact value `fake` selects the deterministic `FakeAiProvider`
 * (used by the default test suite so it runs green with no live key); any other
 * value — unset, empty, or differently-cased — selects the live provider, so
 * production and the opt-in live-LLM tier are safe by default. Selection happens
 * ONLY here; no call site reads `TB_AI_PROVIDER`.
 */

import { AiProvider } from "./ai-provider.ts";
import { OpenRouterAiProvider } from "./openrouter-provider.ts";
import { FakeAiProvider } from "./fake-provider.ts";

export function createAiProvider(): AiProvider {
  if (Deno.env.get("TB_AI_PROVIDER") === "fake") {
    return new FakeAiProvider();
  }
  return new OpenRouterAiProvider();
}
