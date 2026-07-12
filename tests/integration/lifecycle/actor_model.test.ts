// memory-lifecycle-rules → "Single mutation ruleset parameterized by actor".
//
// Red-by-design: the `actor` dimension (LLM | user | sync) is not yet a
// first-class part of the mutation path. The proposed surface (mutations record
// their actor, e.g. via `thoughts.last_actor`, and every actor routes through
// the ONE server-side update path) is finalized by Step 7; each test anchors its
// red on that absence and documents the invariant it guards.

import { assert } from "@std/assert";
import { columnExists } from "./_tools.ts";
import { pending, pendingName } from "./_pending.ts";

const ACTOR_SLUG = "actor-model";

// Invariant 2: a console (user) edit passes through the SAME rules/side effects
// as an LLM edit, with only the actor recorded differently.
Deno.test(
  pendingName(
    "actor: a console edit flows through the same rules as an LLM edit",
    "step7",
    ACTOR_SLUG,
  ),
  async () => {
    assert(
      await columnExists("thoughts", "last_actor"),
      pending(
        "step7",
        ACTOR_SLUG,
        "no actor dimension on the mutation path (thoughts.last_actor absent); cannot prove user and LLM edits share one ruleset",
      ),
    );
  },
);

// A consent-gated outcome renders per actor (UI prompt vs tool-call question)
// but is the SAME rule with an identical underlying state transition.
Deno.test(
  pendingName(
    "actor: a consent-gated outcome renders per actor but is the same rule",
    "step7",
    ACTOR_SLUG,
  ),
  async () => {
    assert(
      await columnExists("thoughts", "last_actor"),
      pending(
        "step7",
        ACTOR_SLUG,
        "the actor-conditioned consent rule has no structural home yet (thoughts.last_actor absent)",
      ),
    );
  },
);

// No console-only or connector-only write may bypass the ruleset's validations.
Deno.test(
  pendingName(
    "actor: no unauthorized direct-write surface exists",
    "step7",
    ACTOR_SLUG,
  ),
  async () => {
    assert(
      await columnExists("thoughts", "last_actor"),
      pending(
        "step7",
        ACTOR_SLUG,
        "cannot assert every write routes through the one actor-tagged path until the actor dimension exists",
      ),
    );
  },
);
