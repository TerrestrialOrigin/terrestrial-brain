// memory-lifecycle-rules → "Write-time deduplication gate".
//
// The server-side write-time dedup gate ships (`capture_thought` runs a
// content-hash + embedding-band check, and a partial unique index enforces exact
// dedup atomically). These assert the gate's EFFECTS on durable row counts. Each
// dedup fixture first asserts its embedding-band precondition (design D4) so a
// drifted fixture fails its own precondition rather than silently invalidating
// the rule.

import { assert } from "@std/assert";
import { callTool } from "../../helpers/mcp-client.ts";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
  thoughtById,
  thoughtsByMarker,
} from "./_thoughts.ts";
import { assertInDedupBand, assertOutsideDedupBand } from "./_embedding.ts";

function activeCount(rows: { archived_at: string | null }[]): number {
  return rows.filter((row) => row.archived_at === null).length;
}

// A byte-identical second capture must not create a duplicate.
Deno.test(
  "dedup: byte-identical capture is blocked",
  async () => {
    const marker = lifecycleMarker("dedup-identical");
    const content = `${marker} identical alpha beta gamma delta`;
    try {
      await assertInDedupBand(content, content); // distance 0
      await captureThought(marker, content);
      await captureThought(marker, content);
      const rows = await thoughtsByMarker(marker);
      assert(
        activeCount(rows) === 1,
        `identical capture must yield 1 active row, got ${
          activeCount(rows)
        } (no write-time dedup)`,
      );
    } finally {
      await deleteThoughtsByMarker(marker);
    }
  },
);

// A within-band restatement must be dropped in favor of the existing thought.
Deno.test(
  "dedup: within-band restatement is dropped for the existing thought",
  async () => {
    const marker = lifecycleMarker("dedup-restate");
    const original = `${marker} the quick brown fox jumps over`;
    const restatement = `${marker} the quick brown fox jumps over today`;
    try {
      await assertInDedupBand(original, restatement);
      await captureThought(marker, original);
      await captureThought(marker, restatement);
      const rows = await thoughtsByMarker(marker);
      assert(
        activeCount(rows) === 1,
        `a within-band restatement must not add a row, got ${
          activeCount(rows)
        } active`,
      );
    } finally {
      await deleteThoughtsByMarker(marker);
    }
  },
);

// Behavioral: a cross-context duplicate must be PRESERVED and routed through the
// supersession edge, never silently deleted. Two thoughts are both kept; marking
// one superseded by the other preserves the older row (reversible) rather than
// dropping it. (Automatic in-band near-dup DETECTION → supersession routing is
// model judgment, covered by the opt-in eval tier; here we assert the mechanism
// that keeps a supersession candidate instead of destroying it.)
Deno.test(
  "dedup: cross-context near-duplicate is preserved as a supersession candidate",
  async () => {
    const marker = lifecycleMarker("dedup-supersede");
    const older = `${marker} apple orange banana grape melon`;
    const newer = `${marker} zeppelin quantum voltage tundra basalt`;
    try {
      await assertOutsideDedupBand(older, newer);
      const olderThought = await captureThought(marker, older);
      const newerThought = await captureThought(marker, newer);
      // Both preserved — neither silently dropped.
      assert(
        activeCount(await thoughtsByMarker(marker)) === 2,
        "both thoughts must be preserved before supersession",
      );

      // Route one to supersession: the older row is KEPT (candidate), not deleted.
      await callTool("resolve_supersession", {
        id: olderThought.id,
        superseded_by: newerThought.id,
      });
      const stillThere = await thoughtById(olderThought.id);
      assert(
        stillThere !== null,
        "a superseded (candidate) thought must be preserved, not deleted",
      );
    } finally {
      await deleteThoughtsByMarker(marker);
    }
  },
);

// Pass-now: genuinely distinct content (well outside the band) is written as a
// new row with no dedup interference — proves the harness runs against real code.
Deno.test("dedup: distinct content well outside the band is written normally", async () => {
  const marker = lifecycleMarker("dedup-distinct");
  const first = `${marker} apple orange banana grape melon`;
  const second = `${marker} zeppelin quantum voltage tundra basalt`;
  try {
    await assertOutsideDedupBand(first, second);
    await captureThought(marker, first);
    await captureThought(marker, second);
    const rows = await thoughtsByMarker(marker);
    assert(
      activeCount(rows) === 2,
      `distinct content must both persist, got ${
        activeCount(rows)
      } active rows`,
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});
