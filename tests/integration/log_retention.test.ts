import { assertEquals } from "@std/assert";
import { createServiceClient, uniqueToken } from "../helpers/mcp-client.ts";

// Integration tests for function_call_logs retention & integrity (Step 25, X7).
// Exercises the purge_function_call_logs RPC and the CHECK constraints against
// the real local database via the service-role client.

const supabase = createServiceClient();

Deno.test("purge_function_call_logs deletes only rows older than the window", async () => {
  const marker = `retention-${uniqueToken()}`;
  const now = new Date();
  const oldStamp = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000)
    .toISOString(); // 100 days ago
  const recentStamp = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
    .toISOString(); // 1 day ago

  const { error: insertError } = await supabase.from("function_call_logs")
    .insert([
      { function_name: marker, function_type: "mcp", called_at: oldStamp },
      { function_name: marker, function_type: "mcp", called_at: oldStamp },
      { function_name: marker, function_type: "mcp", called_at: recentStamp },
    ]);
  assertEquals(insertError, null);

  // Purge everything older than 30 days.
  const { data: deletedCount, error: purgeError } = await supabase.rpc(
    "purge_function_call_logs",
    { retention_days: 30 },
  );
  assertEquals(purgeError, null);
  // At least our two old rows were removed (other tests may add old rows too).
  assertEquals(typeof deletedCount, "number");

  // Our recent row survives; our old rows are gone.
  const { data: survivors } = await supabase
    .from("function_call_logs")
    .select("called_at")
    .eq("function_name", marker);
  assertEquals(survivors?.length, 1);
  // Compare by instant (the DB renders the offset as +00:00, not Z).
  assertEquals(
    new Date(survivors?.[0].called_at ?? 0).getTime(),
    new Date(recentStamp).getTime(),
  );

  // Cleanup our surviving row.
  await supabase.from("function_call_logs").delete().eq(
    "function_name",
    marker,
  );
});

Deno.test("function_call_logs rejects an invalid function_type", async () => {
  const { error } = await supabase.from("function_call_logs").insert({
    function_name: `bad-type-${uniqueToken()}`,
    function_type: "not-a-valid-type",
  });
  // A CHECK-constraint violation surfaces as an error (not a silent insert).
  assertEquals(error !== null, true);
});

Deno.test("function_call_logs rejects an empty function_name", async () => {
  const { error } = await supabase.from("function_call_logs").insert({
    function_name: "",
    function_type: "mcp",
  });
  assertEquals(error !== null, true);
});
