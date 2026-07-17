// memory-lifecycle-rules → "Archival is multi-signal and human-queued".
//
// Behavioral coverage (TEST-1): the archival review queue surfaces only thoughts
// satisfying the FULL conjunction (age ∧ score-0 ∧ never-retrieved ∧ not owned
// by a synced note), excludes synced-note-owned thoughts, and archiving a queued
// item is a consented state transition (stamps archived_at) while an unconfirmed
// item stays active. Fixtures are captured through the real tool (so they carry a
// real embedding) then patched into the target lifecycle state.

import { assert, assertEquals } from "@std/assert";
import { callTool } from "../../helpers/mcp-client.ts";
import {
  captureThought,
  createNoteSnapshot,
  deleteNoteSnapshot,
  deleteThoughtsByMarker,
  isoDaysAgo,
  lifecycleMarker,
  patchThought,
  thoughtById,
} from "./_thoughts.ts";

// Older than ARCHIVAL_AGE_DAYS (90) so the age signal is satisfied.
const OLD_ISO = isoDaysAgo(100);

// The conjunction (age ∧ score-0 ∧ no retrieval ∧ not synced) gates the queue.
Deno.test(
  "archival: the archival conjunction gates the queue",
  async () => {
    const marker = lifecycleMarker("archival-conjunction");
    try {
      // Distinct word sets per fixture so the (now-real) dedup gate does not
      // collapse them — each is genuinely different content, same marker.
      // Satisfies EVERY signal → must appear.
      const inQueue = await captureThought(
        marker,
        `${marker} apple orange banana grape melon`,
      );
      await patchThought(inQueue.id, {
        created_at: OLD_ISO,
        usefulness_score: 0,
        last_retrieved_at: null,
        note_snapshot_id: null,
      });

      // Near-misses, each violating exactly ONE signal → must NOT appear.
      const recent = await captureThought(
        marker,
        `${marker} zeppelin quantum voltage tundra basalt`,
      );
      await patchThought(recent.id, {
        usefulness_score: 0,
        last_retrieved_at: null,
      }); // created_at stays recent (violates age)

      const scored = await captureThought(
        marker,
        `${marker} umbrella keyboard mountain river forest`,
      );
      await patchThought(scored.id, {
        created_at: OLD_ISO,
        usefulness_score: 5,
        last_retrieved_at: null,
      });

      const retrieved = await captureThought(
        marker,
        `${marker} guitar planet whisker copper lantern`,
      );
      await patchThought(retrieved.id, {
        created_at: OLD_ISO,
        usefulness_score: 0,
        last_retrieved_at: OLD_ISO,
      });

      const queue = await callTool("get_archival_queue", {});
      assert(
        queue.includes(inQueue.id),
        "the full-conjunction thought must be in the archival queue",
      );
      for (
        const [label, id] of [
          ["recent", recent.id],
          ["scored", scored.id],
          ["retrieved", retrieved.id],
        ] as const
      ) {
        assert(
          !queue.includes(id),
          `the ${label} near-miss (${id}) violates one signal and must not be queued`,
        );
      }
    } finally {
      await deleteThoughtsByMarker(marker);
    }
  },
);

// A thought owned by a live synced note is never auto-queued regardless of age/score.
Deno.test(
  "archival: a synced-note-owned thought is never auto-queued",
  async () => {
    const marker = lifecycleMarker("archival-synced");
    let snapshotId: string | null = null;
    try {
      const thought = await captureThought(
        marker,
        `${marker} synced conjunction candidate`,
      );
      snapshotId = await createNoteSnapshot(marker);
      // Satisfies age/score/retrieval but IS owned by a synced note.
      await patchThought(thought.id, {
        created_at: OLD_ISO,
        usefulness_score: 0,
        last_retrieved_at: null,
        note_snapshot_id: snapshotId,
      });

      const queue = await callTool("get_archival_queue", {});
      assert(
        !queue.includes(thought.id),
        "a synced-note-owned thought must be excluded from the archival queue",
      );
    } finally {
      await deleteThoughtsByMarker(marker);
      if (snapshotId) await deleteNoteSnapshot(snapshotId);
    }
  },
);

// Archiving a queued item is a consented state transition (stamps archived_at);
// an unconfirmed item stays active.
Deno.test(
  "archival: archiving a queued item is a consented state transition",
  async () => {
    const marker = lifecycleMarker("archival-consent");
    try {
      const queued = await captureThought(
        marker,
        `${marker} apple orange banana grape melon`,
      );
      const untouched = await captureThought(
        marker,
        `${marker} zeppelin quantum voltage tundra basalt`,
      );
      for (const id of [queued.id, untouched.id]) {
        await patchThought(id, {
          created_at: OLD_ISO,
          usefulness_score: 0,
          last_retrieved_at: null,
          note_snapshot_id: null,
        });
      }

      // Consented archive of ONE queued item stamps archived_at.
      await callTool("archive_thought", { id: queued.id });
      const archivedRow = await thoughtById(queued.id);
      assert(
        archivedRow?.archived_at !== null,
        "a consented archive must stamp archived_at",
      );

      // The other queued item, not confirmed, stays active.
      const stillActive = await thoughtById(untouched.id);
      assertEquals(
        stillActive?.archived_at,
        null,
        "an unconfirmed queued item must remain active",
      );
    } finally {
      await deleteThoughtsByMarker(marker);
    }
  },
);
