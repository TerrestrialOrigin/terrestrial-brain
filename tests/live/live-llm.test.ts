import { assert, assertEquals } from "@std/assert";
import { OpenRouterAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/openrouter-provider.ts";

// Opt-in live-LLM tier (fix-plan Step 22). NOT part of `deno task test`; run
// explicitly with `deno task test:live-llm` and a real key:
//
//   OPENROUTER_API_KEY=sk-... deno task test:live-llm
//
// This is NOT a skip: with no key set, the real provider throws a clear
// `requireEnv` error naming OPENROUTER_API_KEY (fail-loud), so an accidental
// keyless run is an obvious failure rather than a silent pass. Its purpose is a
// smoke check that the real upstream still returns well-formed responses; the
// deterministic FakeAiProvider covers all behavior in the default suite.

const provider = new OpenRouterAiProvider();

Deno.test("live: getEmbedding returns a 1536-dim numeric vector", async () => {
  const vector = await provider.getEmbedding(
    "a live smoke-test thought about gardening",
  );
  assertEquals(vector.length, 1536);
  assert(
    vector.every((value) =>
      typeof value === "number" && Number.isFinite(value)
    ),
  );
});

Deno.test("live: completeJson parses a JSON-mode response", async () => {
  const result = await provider.completeJson<{ ok: boolean }>(
    {
      purpose: "reconcile",
      systemPrompt: 'Reply with JSON only. Return exactly {"ok": true}.',
      userContent: "ping",
    },
    (raw) => raw as { ok: boolean },
  );
  // We assert the transport parsed a JSON object with the expected key present;
  // the model is nondeterministic, so we don't over-constrain the value.
  assert(
    "ok" in result,
    `Expected an "ok" key in the parsed response, got ${
      JSON.stringify(result)
    }`,
  );
});
