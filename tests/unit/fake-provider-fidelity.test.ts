import { assert, assertEquals, assertRejects } from "@std/assert";
import { FakeAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts";
import { AiProviderParseError } from "../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";
import type { AiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";
import {
  extractMetadata,
  parseSplitThoughts,
} from "../../supabase/functions/terrestrial-brain-mcp/helpers.ts";

// Fake/live-provider fidelity (CORE-1, CORE-8) + split-callback hardening
// (CORE-12). These pin that the deterministic stub faithfully exercises the
// REAL call sites' code paths, not a drifted matcher string.

// ---------------------------------------------------------------------------
// CORE-1 — the fake genuinely exercises extractMetadata's enrichment path.
// Driving the REAL extractMetadata through the fake must yield enriched
// metadata (topics), not the {}-default that a drifted matcher produced.
// ---------------------------------------------------------------------------

Deno.test("fidelity: real extractMetadata through the fake yields enriched metadata (topics)", async () => {
  const metadata = await extractMetadata(
    new FakeAiProvider(),
    "Gardening notes for spring",
  );
  assert(
    Array.isArray(metadata.topics) && metadata.topics.length >= 1,
    `expected non-empty topics from the fake, got ${
      JSON.stringify(metadata.topics)
    }`,
  );
  assertEquals(metadata.type, "observation");
});

// ---------------------------------------------------------------------------
// CORE-8 — FakeAiProvider.completeJson wraps a throwing parse callback in
// AiProviderParseError, matching the live provider's seam contract, so callers'
// `instanceof AiProviderParseError` fallback branches engage identically.
// ---------------------------------------------------------------------------

Deno.test("fidelity: fake completeJson wraps a throwing parse in AiProviderParseError", async () => {
  const fake: AiProvider = new FakeAiProvider();
  await assertRejects(
    () =>
      fake.completeJson(
        { purpose: "extract-metadata", systemPrompt: "x", userContent: "y" },
        () => {
          throw new Error("parse blew up");
        },
      ),
    AiProviderParseError,
  );
});

// ---------------------------------------------------------------------------
// CORE-12 — the split parse callback skips malformed elements instead of
// crashing the whole batch on a null/typed-wrong element.
// ---------------------------------------------------------------------------

Deno.test("parseSplitThoughts: skips null/malformed elements, keeps valid strings and {thought} objects", () => {
  const result = parseSplitThoughts({
    thoughts: [null, "a real thought", { thought: "wrapped" }, 7, "  ", {}],
  });
  assertEquals(result, ["a real thought", "wrapped"]);
});

Deno.test("parseSplitThoughts: non-object / missing thoughts yields empty array", () => {
  assertEquals(parseSplitThoughts(null), []);
  assertEquals(parseSplitThoughts("nope"), []);
  assertEquals(parseSplitThoughts({}), []);
  assertEquals(parseSplitThoughts({ thoughts: "not-an-array" }), []);
});
