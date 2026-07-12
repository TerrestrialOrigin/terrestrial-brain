// memory-lifecycle-rules → "Single mutation ruleset parameterized by actor".
//
// Step 7 implements the actor dimension: mutations record `last_actor`
// (LLM | user | sync) through the ONE update path. The console (user) and
// connectors (sync) pass their actor through the SAME path/side-effects as an
// LLM edit — no parallel, more-permissive ruleset (Invariant 2).

import { assert, assertEquals } from "@std/assert";
import { callTool, restUrl, serviceHeaders } from "../../helpers/mcp-client.ts";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
} from "./_thoughts.ts";

async function actorAndHash(
  id: string,
): Promise<{ last_actor: string | null; content_hash: string | null }> {
  const response = await fetch(
    restUrl(`thoughts?id=eq.${id}&select=last_actor,content_hash`),
    { headers: serviceHeaders() },
  );
  const rows = await response.json() as {
    last_actor: string | null;
    content_hash: string | null;
  }[];
  return rows[0] ?? { last_actor: null, content_hash: null };
}

// A console (user) edit flows through the same update path — same side effects
// (re-hash), only the recorded actor differs from an LLM edit.
Deno.test("actor: a console (user) edit flows through the same rules as an LLM edit", async () => {
  const marker = lifecycleMarker("actor-user");
  try {
    const thought = await captureThought(marker, `${marker} captured by llm`);
    const asCaptured = await actorAndHash(thought.id);
    assertEquals(asCaptured.last_actor, "LLM", "capture records the LLM actor");

    await callTool("update_thought", {
      id: thought.id,
      content: `${marker} edited in the console`,
      actor: "user",
    });
    const asEdited = await actorAndHash(thought.id);
    assertEquals(
      asEdited.last_actor,
      "user",
      "a console edit records the user actor",
    );
    assert(
      asEdited.content_hash !== null &&
        asEdited.content_hash !== asCaptured.content_hash,
      "the user edit re-hashed via the same path (same side effects as an LLM edit)",
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// The same rule fires for a sync actor — no connector-only write surface.
Deno.test("actor: a sync edit is recorded through the same path", async () => {
  const marker = lifecycleMarker("actor-sync");
  try {
    const thought = await captureThought(marker, `${marker} original`);
    await callTool("update_thought", {
      id: thought.id,
      content: `${marker} synced`,
      actor: "sync",
    });
    assertEquals((await actorAndHash(thought.id)).last_actor, "sync");
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// Every mutation records an actor — there is no unauthorized write that leaves
// the actor unset (defaults to LLM through the one path).
Deno.test("actor: every mutation records an actor (no unauthorized direct-write)", async () => {
  const marker = lifecycleMarker("actor-default");
  try {
    const thought = await captureThought(marker, `${marker} probe`);
    // An update with no explicit actor still records one (default LLM).
    await callTool("update_thought", {
      id: thought.id,
      reliability: "reliable",
    });
    assertEquals((await actorAndHash(thought.id)).last_actor, "LLM");
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});
