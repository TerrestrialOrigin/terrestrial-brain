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

export class OpenRouterAiProvider implements AiProvider {
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

  async getEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${OPENROUTER_BASE}/embeddings`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });
    if (!response.ok) {
      throw new AiProviderHttpError(
        "OpenRouter embeddings",
        response.status,
        await this.readErrorBody(response),
      );
    }
    const data = await response.json();
    return data.data[0].embedding;
  }

  async completeJson<Parsed>(
    request: AiJsonCompletionRequest,
    parse: (raw: unknown) => Parsed,
  ): Promise<Parsed> {
    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({
        model: request.model ?? CHAT_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userContent },
        ],
      }),
    });

    if (!response.ok) {
      throw new AiProviderHttpError(
        "OpenRouter completion",
        response.status,
        await this.readErrorBody(response),
      );
    }

    let content: unknown;
    try {
      const data = await response.json();
      content = JSON.parse(data.choices[0].message.content);
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
