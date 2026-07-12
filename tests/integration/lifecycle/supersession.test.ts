// memory-lifecycle-rules → "Contradiction handling by supersession, not deletion".
//
// Step 7 implements the supersession MECHANISM: a `superseded_by` edge, a
// `resolve_supersession` tool, and `search_thoughts_by_embedding` recreated to
// exclude superseded thoughts from default results (kept, retrievable by id).
// Contradiction *detection* (choosing WHAT to supersede) is model judgment,
// covered by the opt-in eval tier — these deterministic tests assert the EFFECT.

import { assert } from "@std/assert";
import { callTool } from "../../helpers/mcp-client.ts";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
  thoughtById,
} from "./_thoughts.ts";
import { columnExists } from "./_tools.ts";

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

// A supersession/resolve that mutates stored content re-hashes it (INVARIANT 1).
// The content_hash surface that guarantees this exists on thoughts (the full
// re-hash-on-edit behavior is asserted in invariant1_reembed_rehash.test.ts).
Deno.test("supersession: the re-hash surface exists for superseded content", async () => {
  assert(
    await columnExists("thoughts", "content_hash"),
    "content_hash must exist so a content-mutating resolve re-hashes the survivor",
  );
});
