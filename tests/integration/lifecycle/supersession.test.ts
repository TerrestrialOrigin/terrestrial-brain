// memory-lifecycle-rules → "Contradiction handling by supersession, not deletion".
//
// Red-by-design: no supersedes edge and no resolve tool exist yet. The proposed
// surface (the `thoughts.superseded_by` edge + a `resolve_supersession` tool) is
// finalized by Step 7; each test anchors its red on the concrete absence and
// documents the specced OUTCOME it will assert once the surface exists.

import { assert } from "@std/assert";
import { columnExists, hasTool } from "./_tools.ts";
import { pending, pendingName } from "./_pending.ts";

// Effect: a superseded thought leaves default search while B is returned.
Deno.test(
  pendingName(
    "supersession: a recorded supersession removes the older thought from default search",
    "step7",
    "supersession",
  ),
  async () => {
    assert(
      await columnExists("thoughts", "superseded_by"),
      pending(
        "step7",
        "supersession",
        "the supersedes edge (thoughts.superseded_by) is absent; cannot exclude a superseded thought from default search",
      ),
    );
  },
);

// Effect: the older row still exists (soft state), reversible via the resolve tool.
Deno.test(
  pendingName(
    "supersession: supersession never deletes history",
    "step7",
    "supersession",
  ),
  async () => {
    const edge = await columnExists("thoughts", "superseded_by");
    const resolvable = await hasTool("resolve_supersession");
    assert(
      edge && resolvable,
      pending(
        "step7",
        "supersession",
        `supersession must retain + be reversible (edge=${edge}, resolve_supersession tool=${resolvable})`,
      ),
    );
  },
);

// Effect: mutating stored content on resolve re-embeds/re-hashes the survivor.
Deno.test(
  pendingName(
    "supersession: recording a supersession re-embeds the surviving content",
    "step7",
    "content-hash",
  ),
  async () => {
    assert(
      await columnExists("thoughts", "content_hash"),
      pending(
        "step7",
        "content-hash",
        "cannot verify the re-embed/re-hash invariant fires on a supersession until thoughts.content_hash exists",
      ),
    );
  },
);
