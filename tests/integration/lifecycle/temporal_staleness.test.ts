// memory-lifecycle-rules → "Temporal validity and staleness decay signal".
//
// Step 7 implements: a `last_retrieved_at` recency signal advanced on every
// retrieval, and a `get_stale_thoughts` review tool that is multi-signal (age +
// retrieval recency), never score-alone.

import { assert } from "@std/assert";
import { callTool, restUrl, serviceHeaders } from "../../helpers/mcp-client.ts";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
} from "./_thoughts.ts";

async function lastRetrievedAt(id: string): Promise<string | null> {
  const response = await fetch(
    restUrl(`thoughts?id=eq.${id}&select=last_retrieved_at`),
    { headers: serviceHeaders() },
  );
  const rows = (await response.json()) as {
    last_retrieved_at: string | null;
  }[];
  return rows[0]?.last_retrieved_at ?? null;
}

// Retrieval advances the recency signal, independent of usefulness recording.
Deno.test("staleness: retrieval advances the last_retrieved_at signal", async () => {
  const marker = lifecycleMarker("stale-recency");
  try {
    const thought = await captureThought(marker, `${marker} recency probe`);
    assert(
      (await lastRetrievedAt(thought.id)) === null,
      "a freshly captured thought has no retrieval signal yet",
    );
    await callTool("get_thought_by_id", { id: thought.id });
    assert(
      (await lastRetrievedAt(thought.id)) !== null,
      "retrieval must advance last_retrieved_at",
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// Score 0 means "no data", not "stale" — a recent score-0 thought is not stale.
Deno.test("staleness: a recent score-zero thought is not in the stale queue", async () => {
  const marker = lifecycleMarker("stale-scorezero");
  try {
    const thought = await captureThought(marker, `${marker} fresh score zero`);
    const queue = await callTool("get_stale_thoughts", {});
    assert(
      !queue.includes(thought.id),
      "a just-captured (recent) score-0 thought must not be classified stale",
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// The stale-review queue is exposed via an MCP tool (review only, not applied).
Deno.test("staleness: the stale-review queue tool responds", async () => {
  const queue = await callTool("get_stale_thoughts", {});
  assert(
    typeof queue === "string" && queue.length > 0,
    "get_stale_thoughts must return a review queue response",
  );
});
