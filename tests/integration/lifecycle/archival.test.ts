// memory-lifecycle-rules → "Archival is multi-signal and human-queued".
//
// Red-by-design: the archival review queue (the age AND score-0 AND no-retrieval
// AND not-synced conjunction, surfaced for consented action) does not exist yet.
// Proposed surface (`get_archival_queue` tool) is finalized by Step 7. The bare
// `archive_thought` tool ships, but the multi-signal queue + consent flow is new.

import { assert } from "@std/assert";
import { hasTool } from "./_tools.ts";

const ARCHIVAL_TOOL = "get_archival_queue";

// The conjunction (age ∧ score-0 ∧ no retrieval ∧ not synced) gates the queue.
Deno.test(
  "archival: the archival conjunction gates the queue",
  async () => {
    assert(
      await hasTool(ARCHIVAL_TOOL),
      `no archival review queue (${ARCHIVAL_TOOL} tool absent); the multi-signal conjunction is unenforced`,
    );
  },
);

// A thought owned by a live synced note is never auto-queued regardless of age/score.
Deno.test(
  "archival: a synced-note-owned thought is never auto-queued",
  async () => {
    assert(
      await hasTool(ARCHIVAL_TOOL),
      `cannot prove synced-note-owned thoughts are excluded until ${ARCHIVAL_TOOL} exists`,
    );
  },
);

// Archiving a queued item is a consented state transition (stamps archived_at);
// without confirmation it stays active.
Deno.test(
  "archival: archiving a queued item is a consented state transition",
  async () => {
    assert(
      await hasTool(ARCHIVAL_TOOL),
      `the consented archival flow depends on the ${ARCHIVAL_TOOL} queue, which is absent`,
    );
  },
);
