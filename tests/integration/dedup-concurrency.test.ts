import { assertEquals } from "@std/assert";
import { callTool } from "../helpers/mcp-client.ts";
import {
  deleteThoughtsByMarker,
  lifecycleMarker,
  thoughtsByMarker,
} from "./lifecycle/_thoughts.ts";

// TOOL-7: the write-time dedup gate is a check-then-insert, so two concurrent
// captures of identical content both pass the in-memory check and both insert.
// The partial unique index on content_hash makes exact dedup atomic under
// concurrency, and capture_thought treats the 23505 unique-violation as the
// existing "Already captured" success path — so the outcome is exactly one
// active row no matter how the requests interleave.

Deno.test("dedup: concurrent identical captures yield exactly one active row (TOOL-7)", async () => {
  const marker = lifecycleMarker("dedup-concurrent");
  const content =
    `${marker} concurrent alpha beta gamma delta epsilon zeta eta theta`;
  try {
    // Fire several identical captures at once to force the check-then-insert
    // race. Without the DB-level guard this admits duplicate active rows.
    await Promise.all(
      Array.from({ length: 4 }, () => callTool("capture_thought", { content })),
    );

    const rows = await thoughtsByMarker(marker);
    const active = rows.filter((row) => row.archived_at === null);
    assertEquals(
      active.length,
      1,
      `expected exactly 1 active row after concurrent identical captures, got ${active.length}`,
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});
