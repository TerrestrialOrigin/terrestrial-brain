// integration-sync-rules → "Consented close (TB to PMS)" and "Ask-first
// creation (TB to PMS)".
//
// OPT-IN, seam-gated (v1.5). Red-by-design via `PENDING(v1.5:connectors-
// unimplemented)`; the assertions are the v1.5 acceptance contract.

import { assertEquals } from "@std/assert";
import { syncConnector } from "./_sync-seam.ts";

Deno.test("sync: consent yes closes both on success", async () => {
  const connector = syncConnector();
  const result = await connector.closeUpstream("pms-task-2", true);
  assertEquals(result.tbClosed, true);
  assertEquals(result.pmsClosed, true);
});

Deno.test("sync: upstream failure keeps the TB task open", async () => {
  const connector = syncConnector();
  // Consent given but the PMS API call fails → the systems never silently diverge.
  const result = await connector.closeUpstream("pms-task-3-apifail", true);
  assertEquals(result.tbClosed, false);
  assertEquals(result.reminder, true);
});

Deno.test("sync: decline keeps the TB task open", async () => {
  const connector = syncConnector();
  const result = await connector.closeUpstream("pms-task-4", false);
  assertEquals(result.tbClosed, false);
  assertEquals(result.pmsOwnsStatus, true);
});

Deno.test("sync: only consent triggers upstream creation", async () => {
  const connector = syncConnector();
  const result = await connector.createUpstream("conv-task-1", true);
  assertEquals(result.upstreamCreated, true);
  assertEquals(typeof result.externalRef, "string");
});
