// memory-lifecycle-rules → "Temporal validity and staleness decay signal".
//
// Red-by-design: the `last_retrieved_at` recency signal and the staleness review
// queue tool do not exist yet (the `returned_ids` log from Step 2b is their
// precursor). Proposed surface (`thoughts.last_retrieved_at` + a
// `get_stale_thoughts` tool) is finalized by Step 7.

import { assert } from "@std/assert";
import { columnExists, hasTool } from "./_tools.ts";
import { pending, pendingName } from "./_pending.ts";

const STALE_TOOL = "get_stale_thoughts";

// Retrieval must advance a recency signal, independent of usefulness recording.
Deno.test(
  pendingName(
    "staleness: retrieval updates the recency signal",
    "step7",
    "last-retrieved-at",
  ),
  async () => {
    assert(
      await columnExists("thoughts", "last_retrieved_at"),
      pending(
        "step7",
        "last-retrieved-at",
        "thoughts.last_retrieved_at is absent; retrieval recency cannot advance independent of usefulness",
      ),
    );
  },
);

// Score 0 means "no data", never "stale" — staleness is multi-signal.
Deno.test(
  pendingName(
    "staleness: score-zero alone never marks a thought stale",
    "step7",
    "staleness",
  ),
  async () => {
    assert(
      await hasTool(STALE_TOOL),
      pending(
        "step7",
        "staleness",
        `no staleness classifier (${STALE_TOOL} tool absent); cannot prove score-0 recent thoughts are excluded from stale`,
      ),
    );
  },
);

// The stale-review queue is surfaced for review via an MCP tool, not auto-applied.
Deno.test(
  pendingName(
    "staleness: the stale-review queue is exposed via a tool",
    "step7",
    "staleness",
  ),
  async () => {
    assert(
      await hasTool(STALE_TOOL),
      pending(
        "step7",
        "staleness",
        `the ${STALE_TOOL} MCP tool is not registered`,
      ),
    );
  },
);
