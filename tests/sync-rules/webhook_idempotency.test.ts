// integration-sync-rules → "Webhook ingest is idempotent under at-least-once
// delivery".
//
// OPT-IN, seam-gated (v1.5). Red-by-design via `PENDING(v1.5:connectors-
// unimplemented)`; the assertions are the v1.5 acceptance contract.

import { assertEquals } from "@std/assert";
import { syncConnector } from "./_sync-seam.ts";

Deno.test("sync: duplicate delivery does not double-ingest", async () => {
  const connector = syncConnector();
  const event = { id: "evt-1", key: "PROJ-20", contentHash: "abc" };
  await connector.deliverWebhook(event);
  const second = await connector.deliverWebhook(event);
  // The second delivery is a no-op: no duplicate row, no repeated extraction.
  assertEquals(second.applied, false);
  assertEquals(second.extractionTriggered, false);
});

Deno.test("sync: a trivial-edit event below the change gate is ignored", async () => {
  const connector = syncConnector();
  const result = await connector.deliverWebhook({
    id: "evt-2",
    key: "PROJ-21",
    contentHash: "unchanged",
    priorContentHash: "unchanged",
  });
  assertEquals(result.extractionTriggered, false);
});

Deno.test("sync: the reconciliation sweep recovers a missed event", async () => {
  const connector = syncConnector();
  const result = await connector.reconcileSweep();
  // A silently-missed change is picked up; a quiet day is a near no-op (hash gate).
  assertEquals(result.recoveredMissed, true);
});
