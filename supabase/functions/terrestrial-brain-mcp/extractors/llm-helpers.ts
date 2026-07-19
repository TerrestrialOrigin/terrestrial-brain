/**
 * Shared LLM prompt scaffolding for extractors (EXTR-13).
 *
 * Five extractor call sites previously duplicated the same three blocks: the
 * `- "name" (id: ...)` entity-list prompt builder, the valid-id allowlist Set,
 * and the try/completeJson/catch-log-fallback frame. They live here once; each
 * call site keeps its own prompt, parse callback, fallback sentinel, and log
 * label, so per-site observable behavior is unchanged.
 */

import type { AiJsonCompletionRequest, AiProvider } from "../ai/ai-provider.ts";

/**
 * Formats known entities for a system prompt as one `- "name" (id: uuid)` line
 * per entity. Call sites with an empty-list placeholder (e.g. "(none)") apply
 * it themselves — this helper only renders the list lines.
 */
export function formatEntityList(
  entities: { id: string; name: string }[],
): string {
  return entities
    .map((entity) => `- "${entity.name}" (id: ${entity.id})`)
    .join("\n");
}

/**
 * Builds the allowlist of real entity ids that parse callbacks use to reject
 * hallucinated ids before they can flow into a mutation.
 */
export function buildIdAllowlist(entities: { id: string }[]): Set<string> {
  return new Set(entities.map((entity) => entity.id));
}

/**
 * Runs a JSON-mode completion and degrades to `fallback` on any transport or
 * parse failure, logging `<label>: <message>`. The fallback is the call site's
 * own sentinel — some sites use `{ ok: false }` so their caller can distinguish
 * "the call failed" from "the call found nothing", others flatten to an empty
 * list because detection is best-effort.
 */
export async function callJsonWithFallback<Result>(options: {
  aiProvider: AiProvider;
  request: AiJsonCompletionRequest;
  parse: (raw: unknown) => Result;
  fallback: Result;
  label: string;
}): Promise<Result> {
  try {
    return await options.aiProvider.completeJson(
      options.request,
      options.parse,
    );
  } catch (error) {
    console.error(`${options.label}: ${(error as Error).message}`);
    return options.fallback;
  }
}
