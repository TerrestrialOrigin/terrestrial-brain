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

  // Handle SSE response
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find(l => l.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
    return parsed.result?.content?.[0]?.text || "";
  }

  // Handle JSON response
  const parsed = JSON.parse(text);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
  return parsed.result?.content?.[0]?.text || "";
}

// ─── Project Tests ───────────────────────────────────────────────────────────

let testProjectId: string;

Deno.test("create_project creates a project", async () => {
  const result = await callTool("create_project", {
    name: "Integration Test Project",
    type: "personal",
    description: "Created by integration tests",
  });
  assertExists(result);
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain project id");
  testProjectId = match![1];
});

Deno.test("list_projects shows the new project", async () => {
  const result = await callTool("list_projects", {});
  assertExists(result);
  assertEquals(result.includes("Integration Test Project"), true);
});

Deno.test("create_project with parent_id works", async () => {
  const result = await callTool("create_project", {
    name: "Child Test Project",
    type: "personal",
    parent_id: testProjectId,
  });
  assertExists(result);
  assertEquals(result.includes("Child Test Project"), true);
});

Deno.test("get_project shows children", async () => {
  const result = await callTool("get_project", { id: testProjectId });
  assertExists(result);
  assertEquals(result.includes("Child Test Project"), true);
  assertEquals(result.includes("Integration Test Project"), true);
});

Deno.test("update_project changes name", async () => {
  const result = await callTool("update_project", {
    id: testProjectId,
    description: "Updated by integration test",
  });
  assertExists(result);
  assertEquals(result.includes("description"), true);
});

Deno.test("archive_project archives project and children", async () => {
  const result = await callTool("archive_project", { id: testProjectId });
  assertExists(result);
  assertEquals(result.includes("Archived"), true);
});

Deno.test("list_projects hides archived by default", async () => {
  const result = await callTool("list_projects", {});
  assertEquals(result.includes("Integration Test Project"), false);
});
