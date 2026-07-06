import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SupabaseProjectRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-project-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";

// Unit tests for SupabaseProjectRepository (fix-plan Step 17). A fake Supabase
// client records the query chain — no database. GATE 2b: deleting a method's
// query body reddens the matching assertion here.

Deno.test("insert: writes to projects and returns id + name", async () => {
  const { client, recorded } = makeFakeClient({
    data: { id: "p1", name: "Apollo" },
  });
  const repo = new SupabaseProjectRepository(client);

  const { data, error } = await repo.insert({ name: "Apollo" });

  assertEquals(recorded.table, "projects");
  assertEquals(recorded.op, "insert");
  assertEquals(recorded.single, true);
  assertEquals(recorded.payload?.name, "Apollo");
  assertEquals(error, null);
  assertEquals(data?.id, "p1");
});

Deno.test("list: filters archived out and applies parent/type", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseProjectRepository(client);

  await repo.list({ includeArchived: false, parentId: "par", type: "client" });

  assertEquals(recorded.table, "projects");
  assertEquals(recorded.op, "select");
  const filterMethods = recorded.filters.map((filter) => filter.method);
  assertEquals(filterMethods.includes("is"), true); // archived_at is null
  assertEquals(
    recorded.filters.some((f) => f.column === "parent_id" && f.value === "par"),
    true,
  );
  assertEquals(
    recorded.filters.some((f) => f.column === "type" && f.value === "client"),
    true,
  );
});

Deno.test("list: includeArchived true does not filter archived_at", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseProjectRepository(client);

  await repo.list({ includeArchived: true });

  assertEquals(
    recorded.filters.some((f) => f.column === "archived_at"),
    false,
  );
});

Deno.test("findById: selects the full row by id (single)", async () => {
  const { client, recorded } = makeFakeClient({ data: { id: "p1" } });
  const repo = new SupabaseProjectRepository(client);

  await repo.findById("p1");

  assertEquals(recorded.table, "projects");
  assertEquals(recorded.columns, "*");
  assertEquals(recorded.single, true);
  assertEquals(recorded.filters[0]?.column, "id");
});

Deno.test("listActiveChildIds: filters by parent and active", async () => {
  const { client, recorded } = makeFakeClient({ data: [{ id: "c1" }] });
  const repo = new SupabaseProjectRepository(client);

  const { data } = await repo.listActiveChildIds(["p1", "p2"]);

  assertEquals(recorded.columns, "id");
  assertEquals(
    recorded.filters.some((f) => f.method === "in" && f.column === "parent_id"),
    true,
  );
  assertEquals(
    recorded.filters.some((f) => f.column === "archived_at"),
    true,
  );
  assertEquals(data?.[0]?.id, "c1");
});

Deno.test("archiveManyActive: updates archived_at only for active ids", async () => {
  const { client, recorded } = makeFakeClient({ data: null });
  const repo = new SupabaseProjectRepository(client);

  await repo.archiveManyActive(["p1", "p2"]);

  assertEquals(recorded.op, "update");
  assertEquals(typeof recorded.payload?.archived_at, "string");
  assertEquals(
    recorded.filters.some((f) => f.method === "in" && f.column === "id"),
    true,
  );
  assertEquals(
    recorded.filters.some((f) => f.column === "archived_at"),
    true,
  );
});

Deno.test("listActive: id + name of non-archived projects", async () => {
  const { client, recorded } = makeFakeClient({
    data: [{ id: "p1", name: "Apollo" }],
  });
  const repo = new SupabaseProjectRepository(client);

  const { data } = await repo.listActive();

  assertEquals(recorded.columns, "id, name");
  assertEquals(
    recorded.filters.some((f) => f.column === "archived_at"),
    true,
  );
  assertEquals(data?.[0]?.name, "Apollo");
});

Deno.test("propagates a lookup error", async () => {
  const { client } = makeFakeClient({ error: { message: "boom" } });
  const repo = new SupabaseProjectRepository(client);

  const { data, error } = await repo.findById("p1");

  assertEquals(data, null);
  assertEquals(error?.message, "boom");
});
