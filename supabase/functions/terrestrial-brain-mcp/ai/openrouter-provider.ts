/**
 * OpenRouterAiProvider — the ONE implementation of `AiProvider` over OpenRouter
 * (fix-plan Step 15). This is the single home for the base URL, model names, the
 * lazy API-key read, `response.ok` handling, and JSON parsing. It is also the
 * only file in the codebase that should contain the OpenRouter host literal.
 *
 * Behavior is intentionally identical to the 8 fetch blocks it replaces: the
 * transport lives here; each caller keeps its own fallback by mapping the typed
 * errors below.
 */

import { z } from "zod";
import { requireEnv } from "../env.ts";
import {
  AiJsonCompletionRequest,
  AiProvider,
  AiProviderHttpError,
  AiProviderParseError,
} from "./ai-provider.ts";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const CHAT_MODEL = "openai/gpt-4o-mini";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

/** Upstream error pages can be large; bound what we surface/log. */
const MAX_ERROR_BODY = 500;

/** Must match the `thoughts.embedding` column: `vector(1536)`. */
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Outbound request timeouts (CORE-3). Embeddings are quick; a completion may take
 * longer. A hung upstream would otherwise pin the edge invocation until the
 * platform wall-clock kill and stall an entire ingest.
 */
const EMBEDDING_TIMEOUT_MS = 30_000;
const COMPLETION_TIMEOUT_MS = 60_000;

/**
 * Boundary schemas for OpenRouter responses (CORE-4). The upstream payload is
 * external input; validate it ONCE at the door so a malformed body surfaces as a
 * typed `AiProviderParseError` here, not as a Postgres `vector(1536)` error deep
 * in an insert or a raw `TypeError` far from the cause.
 */
const EmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({ embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS) }),
  ).min(1),
});

const CompletionResponseSchema = z.object({
  choices: z.array(
    z.object({ message: z.object({ content: z.string() }) }),
  ).min(1),
});

export class OpenRouterAiProvider implements AiProvider {
  /**
   * `fetchImplementation` is injectable so the transport can be unit-tested with
   * a fake — no network, no key (CORE-4). The default defers to the global
   * `fetch` at call time.
   */
  constructor(
    private readonly fetchImplementation: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}

  /**
   * Read the API key at call time (not construction) so constructing the
   * provider never throws and a missing key fails fast — naming the variable —
   * at the first real call (finding X5).
   */
  private authHeaders(): Record<string, string> {
    const apiKey = requireEnv("OPENROUTER_API_KEY");
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async readErrorBody(response: Response): Promise<string> {
    const body = await response.text().catch(() => "");
    return body.length > MAX_ERROR_BODY
      ? `${body.slice(0, MAX_ERROR_BODY)}…`
      : body;
  }

  /**
   * POSTs a JSON body with a bounded timeout (CORE-3). A timeout/abort surfaces
   * as a typed `AiProviderHttpError` (status 0) so callers' existing HTTP-failure
   * fallback policies apply unchanged, instead of a hung invocation.
   */
  private async postJson(
    url: string,
    body: unknown,
    timeoutMs: number,
    operation: string,
  ): Promise<Response> {
    try {
      return await this.fetchImplementation(url, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new AiProviderHttpError(
          operation,
          0,
          `request timed out after ${timeoutMs}ms`,
        );
      }
      throw error;
    }
  }

  async getEmbedding(text: string): Promise<number[]> {
    const response = await this.postJson(
      `${OPENROUTER_BASE}/embeddings`,
      { model: EMBEDDING_MODEL, input: text },
      EMBEDDING_TIMEOUT_MS,
      "OpenRouter embeddings",
    );
    if (!response.ok) {
      throw new AiProviderHttpError(
        "OpenRouter embeddings",
        response.status,
        await this.readErrorBody(response),
      );
    }
    try {
      const body = EmbeddingResponseSchema.parse(await response.json());
      return body.data[0].embedding;
    } catch (error) {
      throw new AiProviderParseError(
        "OpenRouter embeddings",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async completeJson<Parsed>(
    request: AiJsonCompletionRequest,
    parse: (raw: unknown) => Parsed,
  ): Promise<Parsed> {
    const response = await this.postJson(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        model: request.model ?? CHAT_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userContent },
        ],
      },
      COMPLETION_TIMEOUT_MS,
      "OpenRouter completion",
    );

    if (!response.ok) {
      throw new AiProviderHttpError(
        "OpenRouter completion",
        response.status,
        await this.readErrorBody(response),
      );
    }

    let content: unknown;
    try {
      const body = CompletionResponseSchema.parse(await response.json());
      content = JSON.parse(body.choices[0].message.content);
    } catch (error) {
      throw new AiProviderParseError(
        "OpenRouter completion",
        (error as Error).message,
      );
    }

    try {
      return parse(content);
    } catch (error) {
      throw new AiProviderParseError(
        "OpenRouter completion",
        (error as Error).message,
      );
    }
  }
}
