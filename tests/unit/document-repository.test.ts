import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SupabaseDocumentRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-document-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";

// Unit tests for SupabaseDocumentRepository (fix-plan Step 17).

Deno.test("insert: writes to documents and returns id/title/project_id", async () => {
  const { client, recorded } = makeFakeClient({
    data: { id: "d1", title: "Brief", project_id: "p1" },
  });
  const repo = new SupabaseDocumentRepository(client);

  const { data } = await repo.insert({
    project_id: "p1",
    title: "Brief",
    content: "body",
    references: { people: [], tasks: [] },
  });

  assertEquals(recorded.table, "documents");
  assertEquals(recorded.op, "insert");
  assertEquals(recorded.single, true);
  assertEquals(data?.id, "d1");
});

Deno.test("findById: preserves PGRST116 not-found code", async () => {
  const { client } = makeFakeClient({
    error: { message: "no rows", code: "PGRST116" },
  });
  const repo = new SupabaseDocumentRepository(client);

  const { data, error } = await repo.findById("missing");

  assertEquals(data, null);
  assertEquals(error?.code, "PGRST116");
});

Deno.test("list: applies project/title/search filters + limit", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseDocumentRepository(client);

  await repo.list({
    limit: 20,
    projectId: "p1",
    titleContains: "spec",
    search: "vector",
  });

  assertEquals(recorded.table, "documents");
  assertEquals(recorded.limit, 20);
  assertEquals(
    recorded.filters.some((f) => f.column === "project_id" && f.value === "p1"),
    true,
  );
  // title_contains + search both use ilike (recorded as eq-like? just verify the
  // filters carry the columns with wildcard values)
  assertEquals(
    recorded.filters.some((f) => f.column === "title"),
    true,
  );
  assertEquals(
    recorded.filters.some((f) => f.column === "content"),
    true,
  );
});

Deno.test("findForUpdate: minimal columns by id (single)", async () => {
  const { client, recorded } = makeFakeClient({
    data: { id: "d1", title: "Brief", project_id: "p1" },
  });
  const repo = new SupabaseDocumentRepository(client);

  await repo.findForUpdate("d1");

  assertEquals(recorded.columns, "id, title, project_id");
  assertEquals(recorded.single, true);
});

Deno.test("update: applies partial update by id", async () => {
  const { client, recorded } = makeFakeClient({ data: null });
  const repo = new SupabaseDocumentRepository(client);

  await repo.update("d1", { title: "New" });

  assertEquals(recorded.op, "update");
  assertEquals(recorded.payload?.title, "New");
  assertEquals(recorded.filters[0]?.column, "id");
});
