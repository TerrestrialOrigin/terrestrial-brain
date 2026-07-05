import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SupabaseTaskRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-task-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";

// Unit tests for SupabaseTaskRepository (fix-plan Step 16). A fake Supabase
// client records the query chain each method builds — no database. GATE 2b:
// deleting a method's query body reddens the matching assertion here.

Deno.test("insert: writes to tasks and returns the created row", async () => {
  const { client, recorded } = makeFakeClient({
    data: { id: "new-1", content: "Ship it" },
  });
  const repo = new SupabaseTaskRepository(client);

  const { data, error } = await repo.insert({
    content: "Ship it",
    status: "open",
  });

  assertEquals(recorded.table, "tasks");
  assertEquals(recorded.op, "insert");
  assertEquals(recorded.single, true);
  assertEquals(recorded.payload?.content, "Ship it");
  assertEquals(error, null);
  assertEquals(data?.id, "new-1");
});

Deno.test("list: filters archived out and applies project/status/limit", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseTaskRepository(client);

  await repo.list({
    limit: 20,
    includeArchived: false,
    overdueOnly: false,
    projectId: "proj-1",
    status: "open",
  });

  assertEquals(recorded.table, "tasks");
  assertEquals(recorded.limit, 20);
  const hasFilter = (method: string, column: string) =>
    recorded.filters.some((f) => f.method === method && f.column === column);
  assertEquals(hasFilter("is", "archived_at"), true);
  assertEquals(hasFilter("eq", "project_id"), true);
  assertEquals(hasFilter("eq", "status"), true);
});

Deno.test("list: overdue adds due_by < now and status != done", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseTaskRepository(client);

  await repo.list({ limit: 20, includeArchived: false, overdueOnly: true });

  const hasFilter = (method: string, column: string) =>
    recorded.filters.some((f) => f.method === method && f.column === column);
  assertEquals(hasFilter("lt", "due_by"), true);
  assertEquals(hasFilter("neq", "status"), true);
});

Deno.test("list: includeArchived skips the archived_at filter", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseTaskRepository(client);

  await repo.list({ limit: 5, includeArchived: true, overdueOnly: false });

  assertEquals(
    recorded.filters.some((f) => f.column === "archived_at"),
    false,
  );
});

Deno.test("findByIds: selects tasks by id including parent_id", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseTaskRepository(client);

  await repo.findByIds(["t1", "t2"]);

  assertEquals(recorded.table, "tasks");
  assertExists(recorded.columns);
  assertEquals(recorded.columns?.includes("parent_id"), true);
  const inFilter = recorded.filters.find((f) => f.method === "in");
  assertEquals(inFilter?.column, "id");
  assertEquals(inFilter?.value, ["t1", "t2"]);
});

Deno.test("update: applies the patch to the target id", async () => {
  const { client, recorded } = makeFakeClient({});
  const repo = new SupabaseTaskRepository(client);

  await repo.update("t1", { status: "done" });

  assertEquals(recorded.op, "update");
  assertEquals(recorded.payload?.status, "done");
  const eqId = recorded.filters.find((f) =>
    f.method === "eq" && f.column === "id"
  );
  assertEquals(eqId?.value, "t1");
});

Deno.test("archiveIfActive: sets archived_at + done, guarded on archived_at null", async () => {
  const { client, recorded } = makeFakeClient({});
  const repo = new SupabaseTaskRepository(client);

  await repo.archiveIfActive("t9");

  assertEquals(recorded.op, "update");
  assertEquals(recorded.payload?.status, "done");
  assertExists(recorded.payload?.archived_at);
  const guard = recorded.filters.find((f) =>
    f.method === "is" && f.column === "archived_at"
  );
  assertEquals(guard?.value, null);
});

Deno.test("update: surfaces a DB error in the result", async () => {
  const { client } = makeFakeClient({ error: { message: "boom" } });
  const repo = new SupabaseTaskRepository(client);

  const { error } = await repo.update("t1", { status: "done" });

  assertEquals(error?.message, "boom");
});
