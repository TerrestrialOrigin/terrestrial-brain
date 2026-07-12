// memory-lifecycle-rules → "Every content edit re-embeds and re-hashes (INVARIANT 1)".
//
// The re-embed guarantee ships today for thoughts (`update_thought`); the
// content-hash half and the extension to projects/tasks/documents are Step 7.

import { assert, assertEquals } from "@std/assert";
import { callTool } from "../../helpers/mcp-client.ts";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
} from "./_thoughts.ts";
import { columnExists } from "./_tools.ts";
import { pending, pendingName } from "./_pending.ts";

// Pass-now: editing a thought's content re-embeds, so it is found by its NEW
// wording (the old embedding no longer governs retrieval).
Deno.test("invariant1: edited thought is found by its new wording", async () => {
  const marker = lifecycleMarker("inv1-search");
  try {
    const thought = await captureThought(
      marker,
      `${marker} originaltokenxenon photosynthesis`,
    );
    await callTool("update_thought", {
      id: thought.id,
      content: `${marker} replacementtokenquokka meteorology`,
    });
    const results = await callTool("search_thoughts", {
      query: "replacementtokenquokka meteorology",
      limit: 10,
      threshold: 0.1,
    });
    assert(
      results.includes(marker),
      `expected the re-embedded thought (${marker}) to match its new wording; ` +
        `search returned: ${results.slice(0, 200)}`,
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// Red-by-design: there is no `content_hash` column yet, so the stored hash
// cannot equal the hash of the new content.
Deno.test(
  pendingName(
    "invariant1: stored hash equals the hash of the new content",
    "step7",
    "content-hash",
  ),
  async () => {
    assert(
      await columnExists("thoughts", "content_hash"),
      pending(
        "step7",
        "content-hash",
        "thoughts.content_hash column is absent; the sync dedup gate cannot operate on current text",
      ),
    );
  },
);

// Red-by-design: the re-embed + re-hash guarantee must extend to projects,
// tasks, and documents, not only thoughts.
Deno.test(
  pendingName(
    "invariant1: the guarantee holds for projects, tasks, and documents",
    "step7",
    "invariant1-entities",
  ),
  async () => {
    const projectsHashed = await columnExists("projects", "content_hash");
    const tasksHashed = await columnExists("tasks", "content_hash");
    const documentsHashed = await columnExists("documents", "content_hash");
    assert(
      projectsHashed && tasksHashed && documentsHashed,
      pending(
        "step7",
        "invariant1-entities",
        `content_hash missing on some entity (projects=${projectsHashed}, tasks=${tasksHashed}, documents=${documentsHashed}); INVARIANT 1 not yet extended beyond thoughts`,
      ),
    );
  },
);

// Red-by-design: emptying content is a valid "loaded but empty" edit that must
// still re-hash — verifiable only once content_hash exists.
Deno.test(
  pendingName(
    "invariant1: emptying content is a valid edit, still re-hashed",
    "step7",
    "content-hash",
  ),
  async () => {
    assertEquals(
      await columnExists("thoughts", "content_hash"),
      true,
      pending(
        "step7",
        "content-hash",
        "cannot verify an empty edit is re-hashed as a valid state until thoughts.content_hash exists",
      ),
    );
  },
);
