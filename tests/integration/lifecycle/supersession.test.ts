// memory-lifecycle-rules → "Contradiction handling by supersession, not deletion".
//
// Step 7 implements the supersession MECHANISM: a `superseded_by` edge, a
// `resolve_supersession` tool, and `search_thoughts_by_embedding` recreated to
// exclude superseded thoughts from default results (kept, retrievable by id).
// Contradiction *detection* (choosing WHAT to supersede) is model judgment,
// covered by the opt-in eval tier — these deterministic tests assert the EFFECT.

import { assert, assertEquals } from "@std/assert";
import { callTool, restUrl, serviceHeaders } from "../../helpers/mcp-client.ts";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
  sha256Hex,
  thoughtById,
} from "./_thoughts.ts";

// Effect: a superseded thought leaves default search while the survivor stays.
Deno.test("supersession: a recorded supersession removes the older thought from default search", async () => {
  const marker = lifecycleMarker("supersede-search");
  try {
    const older = await captureThought(
      marker,
      `${marker} quokkasupersede alphaunique betaunique`,
    );
    const newer = await captureThought(
      marker,
      `${marker} zebrareplacement gammaunique deltaunique`,
    );

    // Before: the older thought is findable by its distinctive wording.
    const before = await callTool("search_thoughts", {
      query: "quokkasupersede alphaunique betaunique",
      limit: 10,
      threshold: 0.1,
    });
    assert(
      before.includes(older.id),
      "older thought should be found before supersession",
    );

    // Record the supersession via the tool.
    await callTool("resolve_supersession", {
      id: older.id,
      superseded_by: newer.id,
    });

    // After: default search excludes the superseded thought.
    const after = await callTool("search_thoughts", {
      query: "quokkasupersede alphaunique betaunique",
      limit: 10,
      threshold: 0.1,
    });
    assert(
      !after.includes(older.id),
      "superseded thought must be excluded from default search",
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// Effect: the older row is kept (not deleted) and reversible via the resolve tool.
Deno.test("supersession: supersession never deletes history and is reversible", async () => {
  const marker = lifecycleMarker("supersede-keep");
  try {
    const older = await captureThought(marker, `${marker} original belief`);
    const newer = await captureThought(marker, `${marker} replacement belief`);

    await callTool("resolve_supersession", {
      id: older.id,
      superseded_by: newer.id,
    });
    // The older row still exists (soft state, not deleted) and is fetchable.
    const stillThere = await thoughtById(older.id);
    assert(stillThere !== null, "superseded thought row must still exist");

    // Reverse it: clearing the edge un-supersedes.
    await callTool("resolve_supersession", { id: older.id });
    const reversed = await callTool("search_thoughts", {
      query: "original belief",
      limit: 10,
      threshold: 0.1,
    });
    assert(
      reversed.includes(older.id),
      "clearing the edge must return the thought to default search",
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// Behavioral: recording a supersession and then editing the surviving thought
// re-embeds AND re-hashes the survivor (INVARIANT 1) — the survivor is findable
// by its NEW wording and its stored content_hash equals sha256 of the new text.
Deno.test("supersession: editing the surviving thought re-embeds and re-hashes it", async () => {
  const marker = lifecycleMarker("supersede-rehash");
  try {
    const older = await captureThought(marker, `${marker} outdated premise`);
    const survivor = await captureThought(
      marker,
      `${marker} original survivor wording`,
    );
    await callTool("resolve_supersession", {
      id: older.id,
      superseded_by: survivor.id,
    });

    // Edit the surviving thought's content through the one update path.
    const newContent = `${marker} zebulon marmalade quasar survivor wording`;
    await callTool("update_thought", { id: survivor.id, content: newContent });

    // Re-hashed: the stored content_hash equals sha256 of the new content.
    const rows = await (await fetch(
      restUrl(`thoughts?id=eq.${survivor.id}&select=content_hash`),
      { headers: serviceHeaders() },
    )).json() as { content_hash: string | null }[];
    assertEquals(
      rows[0]?.content_hash,
      await sha256Hex(newContent),
      "the survivor's content_hash must be re-stamped on edit",
    );

    // Re-embedded: the survivor is findable by its new, distinctive wording.
    const found = await callTool("search_thoughts", {
      query: "zebulon marmalade quasar",
      limit: 10,
      threshold: 0.1,
    });
    assert(
      found.includes(survivor.id),
      "the survivor must be findable by its post-edit wording (re-embedded)",
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});
