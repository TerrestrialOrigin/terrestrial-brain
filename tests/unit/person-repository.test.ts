import { assertEquals } from "@std/assert";
import { SupabasePersonRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-person-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";

// Unit tests for SupabasePersonRepository (fix-plan Step 17).

Deno.test("insert: writes to people and returns id + name", async () => {
  const { client, recorded } = makeFakeClient({
    data: { id: "person-1", name: "Ada" },
  });
  const repo = new SupabasePersonRepository(client);

  const { data, error } = await repo.insert({ name: "Ada" });

  assertEquals(recorded.table, "people");
  assertEquals(recorded.op, "insert");
  assertEquals(recorded.single, true);
  assertEquals(recorded.payload?.name, "Ada");
  assertEquals(error, null);
  assertEquals(data?.id, "person-1");
});

Deno.test("list: orders by name, filters archived + type", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabasePersonRepository(client);

  await repo.list({ includeArchived: false, type: "human", limit: 20 });

  assertEquals(recorded.table, "people");
  assertEquals(recorded.order?.column, "name");
  assertEquals(
    recorded.filters.some((f) => f.column === "archived_at"),
    true,
  );
  assertEquals(
    recorded.filters.some((f) => f.column === "type" && f.value === "human"),
    true,
  );
});

Deno.test("findName: selects name by id (single)", async () => {
  const { client, recorded } = makeFakeClient({ data: { name: "Ada" } });
  const repo = new SupabasePersonRepository(client);

  const { data } = await repo.findName("person-1");

  assertEquals(recorded.columns, "name");
  assertEquals(recorded.single, true);
  assertEquals(data?.name, "Ada");
});

Deno.test("archive: sets archived_at by id", async () => {
  const { client, recorded } = makeFakeClient({ data: null });
  const repo = new SupabasePersonRepository(client);

  await repo.archive("person-1");

  assertEquals(recorded.op, "update");
  assertEquals(typeof recorded.payload?.archived_at, "string");
  assertEquals(recorded.filters[0]?.column, "id");
});

Deno.test("listActive: id + name of non-archived people", async () => {
  const { client, recorded } = makeFakeClient({
    data: [{ id: "person-1", name: "Ada" }],
  });
  const repo = new SupabasePersonRepository(client);

  const { data } = await repo.listActive();

  assertEquals(recorded.columns, "id, name");
  assertEquals(
    recorded.filters.some((f) => f.column === "archived_at"),
    true,
  );
  assertEquals(data?.[0]?.name, "Ada");
});
