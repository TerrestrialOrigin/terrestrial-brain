// Pins the field-application behavior of buildThoughtUpdate (extracted from
// update_thought in fix-plan Step 18). The two paths deliberately order the
// confirmation fields differently — content path lists references BEFORE
// top-level fields, non-content path lists top-level fields FIRST. That quirk
// was load-bearing in the pre-refactor branches; these tests lock it in so a
// future "cleanup" can't silently reorder the user-visible confirmation.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildThoughtUpdate } from "../../supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts";
import {
  type AiJsonCompletionRequest,
  type AiProvider,
} from "../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";

function fakeAiProvider(): AiProvider {
  return {
    getEmbedding: () => Promise.resolve([0.5, 0.5]),
    completeJson: <Parsed>(
      _req: AiJsonCompletionRequest,
      parse: (raw: unknown) => Parsed,
    ): Promise<Parsed> =>
      Promise.resolve(parse({ type: "idea", topics: ["x"] })),
  };
}

Deno.test("non-content update: top-level fields first, no metadata when refs unchanged", async () => {
  const { updatePayload, updatedFields } = await buildThoughtUpdate(
    fakeAiProvider(),
    { source: "mcp", type: "observation" },
    { reliability: "reliable", author: "claude" },
  );
  assertEquals(updatedFields, ["reliability", "author"]);
  assertEquals(updatePayload.reliability, "reliable");
  assertEquals(updatePayload.author, "claude");
  // no reference change → no metadata key at all
  assertEquals("metadata" in updatePayload, false);
  assertEquals("content" in updatePayload, false);
  assertEquals("embedding" in updatePayload, false);
});

Deno.test("non-content update with references: top-level THEN references; metadata written", async () => {
  const { updatePayload, updatedFields } = await buildThoughtUpdate(
    fakeAiProvider(),
    { source: "obsidian", references: { projects: ["old"] } },
    { reliability: "reliable", project_ids: ["p1"], document_ids: ["d1"] },
  );
  // ordering: reliability (top-level) before project_ids/document_ids (refs)
  assertEquals(updatedFields, ["reliability", "project_ids", "document_ids"]);
  const meta = updatePayload.metadata as Record<string, unknown>;
  assertEquals(meta.source, "obsidian"); // preserved
  assertEquals(meta.references, { projects: ["p1"], documents: ["d1"] });
});

Deno.test("content update: content label first, THEN references, THEN top-level", async () => {
  const { updatePayload, updatedFields } = await buildThoughtUpdate(
    fakeAiProvider(),
    { source: "mcp", references: { projects: ["keep"] } },
    {
      content: "new body",
      reliability: "less reliable",
      project_ids: ["p2"],
    },
  );
  // content path lists refs BEFORE top-level (opposite of the non-content path)
  assertEquals(updatedFields, [
    "content (embedding + metadata regenerated)",
    "project_ids",
    "reliability",
  ]);
  assertEquals(updatePayload.content, "new body");
  assertEquals(updatePayload.embedding, [0.5, 0.5]);
  const meta = updatePayload.metadata as Record<string, unknown>;
  assertEquals(meta.source, "mcp"); // source preserved, not overwritten
  assertEquals(meta.type, "idea"); // regenerated metadata merged in
  assertEquals(meta.references, { projects: ["p2"] }); // override applied
});

Deno.test("content update with no reference overrides still rewrites metadata + keeps refs", async () => {
  const { updatePayload, updatedFields } = await buildThoughtUpdate(
    fakeAiProvider(),
    { source: "mcp", references: { projects: ["keep"], documents: ["d"] } },
    { content: "changed" },
  );
  assertEquals(updatedFields, ["content (embedding + metadata regenerated)"]);
  const meta = updatePayload.metadata as Record<string, unknown>;
  // existing references preserved unchanged
  assertEquals(meta.references, { projects: ["keep"], documents: ["d"] });
});
