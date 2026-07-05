/**
 * Composition-root factory for the `AiProvider` (fix-plan Step 15).
 *
 * A single place to construct the provider, so Step 22 can add a
 * `TB_AI_PROVIDER=fake` branch here (returning a `FakeAiProvider`) without
 * touching any call site.
 */

import { AiProvider } from "./ai-provider.ts";
import { OpenRouterAiProvider } from "./openrouter-provider.ts";

export function createAiProvider(): AiProvider {
  return new OpenRouterAiProvider();
}
