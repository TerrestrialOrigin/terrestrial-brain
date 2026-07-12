// memory-lifecycle-rules → "Write-time deduplication gate".
//
// No server-side dedup exists today (`capture_thought` inserts unconditionally),
// so the identical/near-dup scenarios are red-by-design. Each dedup fixture
// first asserts its embedding-band precondition (design D4) so a drifted fixture
// fails its own precondition rather than silently invalidating the rule.

import { assert } from "@std/assert";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
  thoughtsByMarker,
} from "./_thoughts.ts";
import { assertInDedupBand, assertOutsideDedupBand } from "./_embedding.ts";
import { columnExists } from "./_tools.ts";

function activeCount(rows: { archived_at: string | null }[]): number {
  return rows.filter((row) => row.archived_at === null).length;
}

// Red-by-design: a byte-identical second capture must not create a duplicate.
Deno.test(
  "dedup: byte-identical capture is blocked",
  async () => {
    const marker = lifecycleMarker("dedup-identical");
    const content = `${marker} identical alpha beta gamma delta`;
    try {
      await assertInDedupBand(content, content); // distance 0
      await captureThought(marker, content);
      await captureThought(marker, content);
      const rows = await thoughtsByMarker(marker);
      assert(
        activeCount(rows) === 1,
        `identical capture must yield 1 active row, got ${
          activeCount(rows)
        } (no write-time dedup)`,
      );
    } finally {
      await deleteThoughtsByMarker(marker);
    }
  },
);

// Red-by-design: a within-band restatement must be dropped in favor of the
// existing thought.
Deno.test(
  "dedup: within-band restatement is dropped for the existing thought",
  async () => {
    const marker = lifecycleMarker("dedup-restate");
    const original = `${marker} the quick brown fox jumps over`;
    const restatement = `${marker} the quick brown fox jumps over today`;
    try {
      await assertInDedupBand(original, restatement);
      await captureThought(marker, original);
      await captureThought(marker, restatement);
      const rows = await thoughtsByMarker(marker);
      assert(
        activeCount(rows) === 1,
        `a within-band restatement must not add a row, got ${
          activeCount(rows)
        } active`,
      );
    } finally {
      await deleteThoughtsByMarker(marker);
    }
  },
);

// Red-by-design: a cross-context near-duplicate must be PRESERVED as a
// supersession candidate, never silently dropped — needs the supersedes edge.
Deno.test(
  "dedup: cross-context near-duplicate is preserved as a supersession candidate",
  async () => {
    assert(
      await columnExists("thoughts", "superseded_by"),
      "a cross-context near-dup must surface as a supersession candidate, not a silent drop; the supersedes edge (thoughts.superseded_by) is absent",
    );
  },
);

// Pass-now: genuinely distinct content (well outside the band) is written as a
// new row with no dedup interference — proves the harness runs against real code.
Deno.test("dedup: distinct content well outside the band is written normally", async () => {
  const marker = lifecycleMarker("dedup-distinct");
  const first = `${marker} apple orange banana grape melon`;
  const second = `${marker} zeppelin quantum voltage tundra basalt`;
  try {
    await assertOutsideDedupBand(first, second);
    await captureThought(marker, first);
    await captureThought(marker, second);
    const rows = await thoughtsByMarker(marker);
    assert(
      activeCount(rows) === 2,
      `distinct content must both persist, got ${
        activeCount(rows)
      } active rows`,
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});
