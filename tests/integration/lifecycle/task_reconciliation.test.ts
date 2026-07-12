// memory-lifecycle-rules → "Task reconciliation is consent-based".
//
// Red-by-design: the reconciliation sweep ("these open tasks look done per
// recent thoughts — confirm to close") does not exist yet. Proposed surface
// (`reconcile_tasks` tool) is finalized by Step 7; it must ASK before closing
// and never auto-close.

import { assert } from "@std/assert";
import { hasTool } from "./_tools.ts";
import { pending, pendingName } from "./_pending.ts";

const RECONCILE_TOOL = "reconcile_tasks";

// The sweep surfaces a confirm-to-close prompt and changes nothing without consent.
Deno.test(
  pendingName(
    "reconciliation: the sweep asks before closing",
    "step7",
    "reconciliation",
  ),
  async () => {
    assert(
      await hasTool(RECONCILE_TOOL),
      pending(
        "step7",
        "reconciliation",
        `no reconciliation sweep (${RECONCILE_TOOL} tool absent); cannot prove it asks before closing`,
      ),
    );
  },
);

// Declining the proposed close leaves the task open with no status write.
Deno.test(
  pendingName(
    "reconciliation: declining leaves the task open",
    "step7",
    "reconciliation",
  ),
  async () => {
    assert(
      await hasTool(RECONCILE_TOOL),
      pending(
        "step7",
        "reconciliation",
        `cannot prove decline leaves a task open until ${RECONCILE_TOOL} exists`,
      ),
    );
  },
);
