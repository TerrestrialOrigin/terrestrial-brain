import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BASE = "http://localhost:54321/functions/v1/terrestrial-brain-mcp?key=dev-test-key-123";

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args }
    })
  });

  const text = await res.text();
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find(l => l.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
    return parsed.result?.content?.[0]?.text || "";
  }
  const parsed = JSON.parse(text);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
  return parsed.result?.content?.[0]?.text || "";
}

// ─── Task Tests ──────────────────────────────────────────────────────────────

const SEED_PROJECT_ID = "00000000-0000-0000-0000-000000000002"; // Terrestrial Brain
let testTaskId: string;

Deno.test("create_task creates a task", async () => {
  const result = await callTool("create_task", {
    content: "Integration test task",
    project_id: SEED_PROJECT_ID,
  });
  assertExists(result);
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain task id");
  testTaskId = match![1];
});

Deno.test("list_tasks shows the new task", async () => {
  const result = await callTool("list_tasks", { project_id: SEED_PROJECT_ID });
  assertExists(result);
  assertEquals(result.includes("Integration test task"), true);
});

Deno.test("update_task changes status to done and archives", async () => {
  const result = await callTool("update_task", {
    id: testTaskId,
    status: "done",
  });
  assertExists(result);
  assertEquals(result.includes("status"), true);
  assertEquals(result.includes("archived_at"), true);
});

Deno.test("list_tasks hides archived by default", async () => {
  const result = await callTool("list_tasks", { project_id: SEED_PROJECT_ID });
  assertEquals(result.includes("Integration test task"), false);
});

Deno.test("create_task and archive_task works", async () => {
  const createResult = await callTool("create_task", {
    content: "Task to archive",
  });
  const match = createResult.match(/id: ([0-9a-f-]+)/);
  assertExists(match);

  const archiveResult = await callTool("archive_task", { id: match![1] });
  assertEquals(archiveResult.includes("archived"), true);
});
