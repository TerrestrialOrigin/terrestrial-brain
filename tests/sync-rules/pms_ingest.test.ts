// integration-sync-rules → "PMS-to-TB ingest maps native status, never board columns".
//
// OPT-IN (`deno task test:sync-rules`), NOT gated. Every scenario routes its
// actor-invocation through the single v1.5 `syncConnector` seam, which throws
// `PENDING(v1.5:connectors-unimplemented)` today — so each test fails red-by-
// design with that one documented reason. The outcome assertions below are the
// v1.5 acceptance contract, reached once the seam is wired.

import { assert, assertEquals } from "@std/assert";
import { syncConnector } from "./_sync-seam.ts";

Deno.test("sync: a new PMS item creates a TB task with an external ref", async () => {
  const connector = syncConnector();
  const result = await connector.ingestItem({
    key: "PROJ-1",
    title: "Migrate billing webhook",
    statusCategory: "To Do",
  });
  assertEquals(result.taskCreated, true);
  assert(typeof result.externalRef === "string" && result.externalRef);
});

Deno.test("sync: native status category is used, not board columns", async () => {
  const connector = syncConnector();
  const result = await connector.ingestItem({
    key: "PROJ-2",
    title: "Review PR",
    boardColumn: "In Review",
    statusCategory: "In Progress",
  });
  // The board column "In Review" must map to the native category, not be stored raw.
  assertEquals(result.status, "in_progress");
});

Deno.test("sync: upstream completion of a known task marks it done", async () => {
  const connector = syncConnector();
  const result = await connector.ingestItem({
    key: "PROJ-3",
    statusCategory: "Done",
    knownInTb: true,
  });
  assertEquals(result.status, "done");
});

Deno.test("sync: upstream completion of an unknown item is ignored", async () => {
  const connector = syncConnector();
  const result = await connector.ingestItem({
    key: "PROJ-UNKNOWN",
    statusCategory: "Done",
    knownInTb: false,
  });
  // No TB task is created from a bare completion event for an unknown item.
  assertEquals(result.taskCreated, false);
});
