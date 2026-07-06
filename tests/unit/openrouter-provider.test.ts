import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { OpenRouterAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/openrouter-provider.ts";
import {
  AiProviderHttpError,
  AiProviderParseError,
} from "../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";

// Unit tests for the single OpenRouter transport. `fetch` is stubbed (restored
// in `finally`) so no network or real key is hit — but a throwaway key must be
// present so the lazy `requireEnv` guard passes before the stubbed fetch runs.
// These pin the throw-vs-parse semantics each of the 8 call sites relies on.

Deno.env.set("OPENROUTER_API_KEY", "test-openrouter-key");

const originalFetch = globalThis.fetch;

async function withFetch(
  impl: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function okCompletion(content: object): typeof fetch {
  return (() =>
    Promise.resolve(
      {
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: JSON.stringify(content) } }],
          }),
      } as Response,
    )) as typeof fetch;
}

// ─── completeJson ───────────────────────────────────────────────────────────

Deno.test("completeJson: returns the parsed value on HTTP 200", async () => {
  await withFetch(okCompletion({ topics: ["a", "b"] }), async () => {
    const provider = new OpenRouterAiProvider();
    const result = await provider.completeJson(
      { systemPrompt: "sys", userContent: "user" },
      (raw) => raw as { topics: string[] },
    );
    assertEquals(result.topics, ["a", "b"]);
  });
});

Deno.test("completeJson: runs the caller's parse callback (allowlist filtering)", async () => {
  await withFetch(okCompletion({ ids: ["keep", "drop"] }), async () => {
    const provider = new OpenRouterAiProvider();
    const allow = new Set(["keep"]);
    const result = await provider.completeJson(
      { systemPrompt: "sys", userContent: "user" },
      (raw) => (raw as { ids: string[] }).ids.filter((id) => allow.has(id)),
    );
    assertEquals(result, ["keep"]);
  });
});

Deno.test("completeJson: throws AiProviderHttpError with status on non-OK", async () => {
  const failing = (() =>
    Promise.resolve(
      {
        ok: false,
        status: 503,
        text: () => Promise.resolve("upstream down"),
      } as Response,
    )) as typeof fetch;
  await withFetch(failing, async () => {
    const provider = new OpenRouterAiProvider();
    const error = await assertRejects(() =>
      provider.completeJson(
        { systemPrompt: "sys", userContent: "user" },
        (raw) => raw,
      )
    );
    assertInstanceOf(error, AiProviderHttpError);
    assertEquals((error as AiProviderHttpError).status, 503);
  });
});

Deno.test("completeJson: throws AiProviderParseError on non-JSON content", async () => {
  const badBody = (() =>
    Promise.resolve(
      {
        ok: true,
        json: () =>
          Promise.resolve({ choices: [{ message: { content: "not json" } }] }),
      } as Response,
    )) as typeof fetch;
  await withFetch(badBody, async () => {
    const provider = new OpenRouterAiProvider();
    const error = await assertRejects(() =>
      provider.completeJson(
        { systemPrompt: "sys", userContent: "user" },
        (raw) => raw,
      )
    );
    assertInstanceOf(error, AiProviderParseError);
  });
});

Deno.test("completeJson: parse callback throwing surfaces as AiProviderParseError", async () => {
  await withFetch(okCompletion({ shape: "wrong" }), async () => {
    const provider = new OpenRouterAiProvider();
    const error = await assertRejects(() =>
      provider.completeJson(
        { systemPrompt: "sys", userContent: "user" },
        () => {
          throw new Error("validation failed");
        },
      )
    );
    assertInstanceOf(error, AiProviderParseError);
  });
});

// ─── getEmbedding ───────────────────────────────────────────────────────────

Deno.test("getEmbedding: returns the vector on HTTP 200", async () => {
  const embed = (() =>
    Promise.resolve(
      {
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as Response,
    )) as typeof fetch;
  await withFetch(embed, async () => {
    const provider = new OpenRouterAiProvider();
    const vector = await provider.getEmbedding("hello");
    assertEquals(vector, [0.1, 0.2, 0.3]);
  });
});

Deno.test("getEmbedding: throws (does not degrade) on non-OK", async () => {
  const failing = (() =>
    Promise.resolve(
      {
        ok: false,
        status: 500,
        text: () => Promise.resolve("boom"),
      } as Response,
    )) as typeof fetch;
  await withFetch(failing, async () => {
    const provider = new OpenRouterAiProvider();
    const error = await assertRejects(() => provider.getEmbedding("hello"));
    assertInstanceOf(error, AiProviderHttpError);
    assertEquals((error as AiProviderHttpError).status, 500);
  });
});
