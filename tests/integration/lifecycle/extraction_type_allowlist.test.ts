// memory-lifecycle-rules → "Extraction type is parsed against an allowlist".
//
// These drive the REAL `extractMetadata` parse seam with the injectable unit
// `FakeAiProvider` (design D5). The AiProvider is the ONLY mock and it sits on
// the legitimate external-LLM boundary; the parse/validate/coerce code under
// test is real. `coerceThoughtType` (helpers.ts) now validates the model's type
// against the `THOUGHT_TYPES` allowlist and degrades out-of-allowlist / missing
// types to the documented `observation` fallback — these assert that behavior.

import { assertEquals } from "@std/assert";
import { extractMetadata } from "../../../supabase/functions/terrestrial-brain-mcp/helpers.ts";
import { FakeAiProvider } from "../../unit/fakes/extraction-fakes.ts";

function providerReturning(raw: unknown): FakeAiProvider {
  return new FakeAiProvider(() => raw);
}

// An allowlisted type flows through unchanged.
Deno.test("extraction: an allowed type is stored as-is", async () => {
  const provider = providerReturning({ type: "idea", topics: ["gardening"] });
  const metadata = await extractMetadata(provider, "a note about gardening");
  assertEquals(metadata.type, "idea");
});

// A hallucinated out-of-allowlist type coerces to the documented fallback.
Deno.test(
  "extraction: an out-of-allowlist type is coerced to the fallback and logged",
  async () => {
    const provider = providerReturning({ type: "sentiment", topics: ["mood"] });
    const metadata = await extractMetadata(provider, "feeling good today");
    assertEquals(
      metadata.type,
      "observation",
      `out-of-allowlist type must coerce to "observation"; got "${metadata.type}"`,
    );
  },
);

// A non-throwing response with no `type` still degrades to the fallback.
Deno.test(
  "extraction: missing/unparseable metadata degrades to the documented fallback",
  async () => {
    const provider = providerReturning({});
    const metadata = await extractMetadata(provider, "some text");
    assertEquals(
      metadata.type,
      "observation",
      `typeless metadata must degrade to "observation"; got "${metadata.type}"`,
    );
  },
);
