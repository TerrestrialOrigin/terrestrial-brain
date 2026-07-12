// memory-lifecycle-rules → "Usefulness reinforcement with rubber-stamp down-weighting".
//
// Server-side usefulness increment ships (get_thought_by_id auto-record;
// record_useful_thoughts +1 via the increment_usefulness RPC). The rubber-stamp
// down-weighting is Step 7.

import { assert, assertEquals } from "@std/assert";
import { callTool } from "../../helpers/mcp-client.ts";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
  thoughtById,
} from "./_thoughts.ts";
import { pending, pendingName } from "./_pending.ts";

async function score(id: string): Promise<number> {
  const row = await thoughtById(id);
  return row?.usefulness_score ?? -1;
}

// Pass-now: a fetch by id reinforces usefulness server-side, no follow-up nudge.
Deno.test("usefulness: get_thought_by_id auto-records server-side", async () => {
  const marker = lifecycleMarker("useful-auto");
  try {
    const thought = await captureThought(marker, `${marker} auto record probe`);
    const before = await score(thought.id);
    await callTool("get_thought_by_id", { id: thought.id });
    const after = await score(thought.id);
    assertEquals(
      after,
      before + 1,
      `expected auto-record to raise usefulness by exactly 1 (before=${before}, after=${after})`,
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// Pass-now: a content edit is not a usefulness signal — a user edit must not
// reinforce the score.
Deno.test("usefulness: a user content edit does not reinforce usefulness", async () => {
  const marker = lifecycleMarker("useful-useredit");
  try {
    const thought = await captureThought(marker, `${marker} first wording`);
    const before = await score(thought.id);
    await callTool("update_thought", {
      id: thought.id,
      content: `${marker} revised wording`,
    });
    const after = await score(thought.id);
    assertEquals(
      after,
      before,
      `a user edit must not change usefulness (before=${before}, after=${after})`,
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// Red-by-design: an all-selecting (rubber-stamp) record must contribute LESS
// per id than a selective record over an equally-sized result set. Today the
// RPC adds +1 per id regardless, so the two are equal.
Deno.test(
  pendingName(
    "usefulness: a selective record increments more per id than a rubber-stamp",
    "step7",
    "rubber-stamp",
  ),
  async () => {
    const markerRubber = lifecycleMarker("useful-rubber");
    const markerSelective = lifecycleMarker("useful-selective");
    try {
      const rubberIds: string[] = [];
      for (let index = 0; index < 3; index++) {
        const thought = await captureThought(
          markerRubber,
          `${markerRubber} rubber ${index}`,
        );
        rubberIds.push(thought.id);
      }
      const selectiveIds: string[] = [];
      for (let index = 0; index < 3; index++) {
        const thought = await captureThought(
          markerSelective,
          `${markerSelective} selective ${index}`,
        );
        selectiveIds.push(thought.id);
      }

      // Rubber-stamp: select ALL returned ids.
      await callTool("record_useful_thoughts", { thought_ids: rubberIds });
      // Selective: select ONE of an equally-sized result set.
      await callTool("record_useful_thoughts", {
        thought_ids: [selectiveIds[0]],
      });

      const rubberWeight = await score(rubberIds[0]);
      const selectiveWeight = await score(selectiveIds[0]);
      assert(
        selectiveWeight > rubberWeight,
        pending(
          "step7",
          "rubber-stamp",
          `a selective pick must out-weight a rubber-stamp per id ` +
            `(selective=${selectiveWeight}, rubber=${rubberWeight}); ` +
            `increment_usefulness currently adds +1 flat`,
        ),
      );
    } finally {
      await deleteThoughtsByMarker(markerRubber);
      await deleteThoughtsByMarker(markerSelective);
    }
  },
);
