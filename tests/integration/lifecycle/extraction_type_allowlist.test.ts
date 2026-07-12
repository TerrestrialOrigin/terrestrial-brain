// memory-lifecycle-rules → "Extraction type is parsed against an allowlist".
//
// These drive the REAL `extractMetadata` parse seam with the injectable unit
// `FakeAiProvider` (design D5). The AiProvider is the ONLY mock and it sits on
// the legitimate external-LLM boundary; the parse/validate/coerce code under
// test is real. Today `helpers.ts` casts the model output (`raw as …`) with no
// `THOUGHT_TYPES` check, so the coercion scenarios are red-by-design until Step 7.

import { assertEquals } from "@std/assert";
import { extractMetadata } from "../../../supabase/functions/terrestrial-brain-mcp/helpers.ts";
import { FakeAiProvider } from "../../unit/fakes/extraction-fakes.ts";
import { pending, pendingName } from "./_pending.ts";

function providerReturning(raw: unknown): FakeAiProvider {
  return new FakeAiProvider(() => raw);
}

// Pass-now: an allowlisted type flows through unchanged.
Deno.test("extraction: an allowed type is stored as-is", async () => {
  const provider = providerReturning({ type: "idea", topics: ["gardening"] });
  const metadata = await extractMetadata(provider, "a note about gardening");
  assertEquals(metadata.type, "idea");
});

// Red-by-design: a hallucinated out-of-allowlist type must coerce to the
// documented fallback `observation` and be logged — today it survives verbatim.
Deno.test(
  pendingName(
    "extraction: an out-of-allowlist type is coerced to the fallback and logged",
    "step7",
    "type-allowlist",
  ),
  async () => {
    const provider = providerReturning({
      type: "sentiment",
      topics: ["mood"],
    });
    const metadata = await extractMetadata(provider, "feeling good today");
    assertEquals(
      metadata.type,
      "observation",
      pending(
        "step7",
        "type-allowlist",
        `out-of-allowlist type must coerce to "observation"; got "${metadata.type}" (no allowlist parse in helpers.ts)`,
      ),
    );
  },
);

// Red-by-design: a non-throwing response with no `type` must still degrade to
// the documented fallback (`observation` / `["uncategorized"]`), not pass an
// undefined type through.
Deno.test(
  pendingName(
    "extraction: missing/unparseable metadata degrades to the documented fallback",
    "step7",
    "type-allowlist",
  ),
  async () => {
    const provider = providerReturning({});
    const metadata = await extractMetadata(provider, "some text");
    assertEquals(
      metadata.type,
      "observation",
      pending(
        "step7",
        "type-allowlist",
        `typeless metadata must degrade to "observation"; got "${metadata.type}"`,
      ),
    );
  },
);
