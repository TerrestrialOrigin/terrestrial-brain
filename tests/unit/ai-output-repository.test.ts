import { assertEquals } from "@std/assert";
import { SupabaseAiOutputRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-ai-output-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";

// Unit tests for SupabaseAiOutputRepository (fix-plan Step 17).

Deno.test("insert: writes to ai_output and returns id", async () => {
  const { client, recorded } = makeFakeClient({ data: { id: "o1" } });
  const repo = new SupabaseAiOutputRepository(client);

  const { data } = await repo.insert({
    title: "Plan",
    content: "# Plan",
    file_path: "plan.md",
  });

  assertEquals(recorded.table, "ai_output");
  assertEquals(recorded.op, "insert");
  assertEquals(recorded.single, true);
  assertEquals(data?.id, "o1");
});

Deno.test("listPending: pending, not rejected, oldest first", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseAiOutputRepository(client);

  await repo.listPending();

  assertEquals(
    recorded.filters.some((f) => f.column === "picked_up" && f.value === false),
    true,
  );
  assertEquals(
    recorded.filters.some((f) => f.column === "rejected" && f.value === false),
    true,
  );
  assertEquals(recorded.order?.column, "created_at");
  assertEquals(recorded.order?.ascending, true);
});

Deno.test("listPendingMetadata: calls the RPC", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseAiOutputRepository(client);

  await repo.listPendingMetadata();

  assertEquals(recorded.rpcName, "get_pending_ai_output_metadata");
});

Deno.test("findContentByIds: id/content for pending, non-rejected ids", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseAiOutputRepository(client);

  await repo.findContentByIds(["o1", "o2"]);

  assertEquals(recorded.columns, "id, content");
  assertEquals(
    recorded.filters.some((f) => f.method === "in" && f.column === "id"),
    true,
  );
});

Deno.test("markPickedUp: sets picked_up + picked_up_at for ids", async () => {
  const { client, recorded } = makeFakeClient({ data: null });
  const repo = new SupabaseAiOutputRepository(client);

  await repo.markPickedUp(["o1"]);

  assertEquals(recorded.op, "update");
  assertEquals(recorded.payload?.picked_up, true);
  assertEquals(typeof recorded.payload?.picked_up_at, "string");
});

Deno.test("reject: sets rejected + rejected_at for ids", async () => {
  const { client, recorded } = makeFakeClient({ data: null });
  const repo = new SupabaseAiOutputRepository(client);

  await repo.reject(["o1"]);

  assertEquals(recorded.op, "update");
  assertEquals(recorded.payload?.rejected, true);
  assertEquals(typeof recorded.payload?.rejected_at, "string");
});
