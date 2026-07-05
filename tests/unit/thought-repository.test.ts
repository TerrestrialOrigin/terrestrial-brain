import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SupabaseThoughtRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-thought-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";

// Unit tests for SupabaseThoughtRepository (fix-plan Step 16). A fake Supabase
// client records the query/RPC each method builds — no database.

Deno.test("matchByEmbedding: calls the match_thoughts RPC with the params", async () => {
  const { client, recorded } = makeFakeClient({
    data: [{ id: "th-1", similarity: 0.9 }],
  });
  const repo = new SupabaseThoughtRepository(client);

  const { data } = await repo.matchByEmbedding({
    embedding: [0.1, 0.2],
    threshold: 0.5,
    count: 10,
    author: "gpt-4o-mini",
    reliability: null,
  });

  assertEquals(recorded.rpcName, "match_thoughts");
  assertEquals(recorded.rpcParams?.match_threshold, 0.5);
  assertEquals(recorded.rpcParams?.match_count, 10);
  assertEquals(recorded.rpcParams?.filter_author, "gpt-4o-mini");
  assertEquals(Array.isArray(data), true);
});

Deno.test("incrementUsefulness: calls the increment_usefulness RPC", async () => {
  const { client, recorded } = makeFakeClient({ data: 2 });
  const repo = new SupabaseThoughtRepository(client);

  const { data } = await repo.incrementUsefulness(["a", "b"]);

  assertEquals(recorded.rpcName, "increment_usefulness");
  assertEquals(recorded.rpcParams?.thought_ids, ["a", "b"]);
  assertEquals(data, 2);
});

Deno.test("findById: preserves the PGRST116 not-found code", async () => {
  const { client } = makeFakeClient({
    error: { message: "no rows", code: "PGRST116" },
  });
  const repo = new SupabaseThoughtRepository(client);

  const { data, error } = await repo.findById("missing");

  assertEquals(data, null);
  assertEquals(error?.code, "PGRST116");
});

Deno.test("list: filters archived out and applies metadata/type filters", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseThoughtRepository(client);

  await repo.list({
    limit: 10,
    includeArchived: false,
    type: "idea",
    projectId: "proj-1",
  });

  assertEquals(recorded.table, "thoughts");
  assertEquals(recorded.limit, 10);
  const filterMethods = recorded.filters.map((f) => `${f.method}:${f.column}`);
  assertEquals(filterMethods.includes("is:archived_at"), true);
  assertEquals(
    recorded.filters.filter((f) => f.method === "contains").length >= 2,
    true,
  );
});

Deno.test("countActive: head count with archived filter, returns the count", async () => {
  const { client, recorded } = makeFakeClient({ count: 42 });
  const repo = new SupabaseThoughtRepository(client);

  const { data } = await repo.countActive();

  assertEquals(recorded.table, "thoughts");
  assertEquals(recorded.selectOptions?.head, true);
  assertEquals(data, 42);
});

Deno.test("archive: soft-archives (update archived_at) rather than deleting", async () => {
  const { client, recorded } = makeFakeClient({});
  const repo = new SupabaseThoughtRepository(client);

  await repo.archive("th-1");

  assertEquals(recorded.op, "update");
  assertEquals(typeof recorded.payload?.archived_at, "string");
  const eqId = recorded.filters.find((f) =>
    f.method === "eq" && f.column === "id"
  );
  assertEquals(eqId?.value, "th-1");
});

Deno.test("findByReference: active thoughts for a note, oldest first", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseThoughtRepository(client);

  await repo.findByReference("notes/foo.md");

  assertEquals(recorded.order?.column, "created_at");
  assertEquals(recorded.order?.ascending, true);
  const refFilter = recorded.filters.find((f) => f.column === "reference_id");
  assertEquals(refFilter?.value, "notes/foo.md");
});
