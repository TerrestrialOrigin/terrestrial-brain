// integration-sync-rules → "One owner per task; PMS owns status for PMS-origin
// tasks" and "No autonomous push to the PMS".
//
// OPT-IN, seam-gated (v1.5). Red-by-design via `PENDING(v1.5:connectors-
// unimplemented)`; the assertions are the v1.5 acceptance contract.

import { assertEquals } from "@std/assert";
import { syncConnector } from "./_sync-seam.ts";

Deno.test("sync: a PMS-origin task's status follows upstream", async () => {
  const connector = syncConnector();
  const result = await connector.ingestItem({
    key: "PROJ-10",
    statusCategory: "In Progress",
    knownInTb: true,
  });
  // TB updates to match on ingest; it never originates a competing status.
  assertEquals(result.status, "in_progress");
  assertEquals(result.originatedCompetingStatus, false);
});

Deno.test("sync: a locally-born task is fully TB-owned", async () => {
  const connector = syncConnector();
  // A task with no external ref is TB-owned; nothing is pushed upstream.
  const result = await connector.createUpstream("local-task-1", false);
  assertEquals(result.upstreamCreated, false);
});

Deno.test("sync: TB never writes upstream unprompted", async () => {
  const connector = syncConnector();
  // A detected change that could propagate must not write upstream without consent.
  const result = await connector.closeUpstream("pms-task-1", false);
  assertEquals(result.upstreamWrite, false);
});
