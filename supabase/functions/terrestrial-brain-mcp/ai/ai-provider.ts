/**
 * AiProvider — the single seam over external embedding and JSON-completion calls
 * (fix-plan Step 15, findings X1/X2).
 *
 * Every call to the LLM/embedding host goes through this interface so that:
 *  - the transport (base URL, model, API key, `response.ok` handling, JSON
 *    parse) lives in exactly ONE implementation, and
 *  - a deterministic fake can be substituted in tests (the seam Step 22's
 *    `FakeAiProvider` plugs into) without a live, paid API key.
 *
 * The provider is injected — passed through tool `register(...)` params and
 * placed on `ExtractionContext` — never imported as a module-level singleton.
 */

/** A JSON-mode chat completion request: a system prompt + user content. */
export interface AiJsonCompletionRequest {
  systemPrompt: string;
  userContent: string;
  /** Overrides the default chat model; omit for the provider's default. */
  model?: string;
}

export interface AiProvider {
  /** Returns the embedding vector for `text`. Throws on transport failure. */
  getEmbedding(text: string): Promise<number[]>;

  /**
   * Sends a JSON-mode chat completion, parses the model's JSON response, and
   * hands the parsed value to `parse` (where the caller validates/reshapes it,
   * e.g. filtering hallucinated ids against an allowlist). Returns `parse`'s
   * result.
   *
   * Throws `AiProviderHttpError` on a non-OK HTTP response and
   * `AiProviderParseError` when the body is not JSON or `parse` throws — so each
   * caller can map those to its own fallback policy (throw vs. degrade).
   */
  completeJson<Parsed>(
    request: AiJsonCompletionRequest,
    parse: (raw: unknown) => Parsed,
  ): Promise<Parsed>;
}

// ---------------------------------------------------------------------------
// Typed errors — let callers distinguish "upstream failed" from "bad response"
// ---------------------------------------------------------------------------

/** Thrown when the LLM/embedding host returns a non-OK HTTP status. */
export class AiProviderHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(operation: string, status: number, body: string) {
    super(`${operation} failed: HTTP ${status} ${body}`);
    this.name = "AiProviderHttpError";
    this.status = status;
    this.body = body;
  }
}

/** Thrown when an OK response body is not valid JSON, or `parse` rejects it. */
export class AiProviderParseError extends Error {
  constructor(operation: string, cause: string) {
    super(`${operation} response could not be parsed: ${cause}`);
    this.name = "AiProviderParseError";
  }
}
