import { assertEquals, assertExists, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

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
    const dataLine = text.split("\n").find(line => line.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
    return parsed.result?.content?.[0]?.text || "";
  }
  const parsed = JSON.parse(text);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
  return parsed.result?.content?.[0]?.text || "";
}

async function callToolRaw(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
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
    const dataLine = text.split("\n").find(line => line.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    return { text: parsed.result?.content?.[0]?.text || "", isError: !!parsed.result?.isError };
  }
  const parsed = JSON.parse(text);
  return { text: parsed.result?.content?.[0]?.text || "", isError: !!parsed.result?.isError };
}

// Seed data IDs from supabase/seed.sql
const CARCHIEF_ID = "00000000-0000-0000-0000-000000000001";
const TERRESTRIAL_BRAIN_ID = "00000000-0000-0000-0000-000000000002";
const CARCHIEF_BACKEND_ID = "00000000-0000-0000-0000-000000000003";

// ─── get_project_summary Tests ─────────────────────────────────────────────

Deno.test("get_project_summary returns project details for seed project", async () => {
  const result = await callTool("get_project_summary", { id: CARCHIEF_ID });
  assertExists(result);
  assertStringIncludes(result, "CarChief");
  assertStringIncludes(result, "client");
  assertStringIncludes(result, "Main client project");
});

Deno.test("get_project_summary shows child projects", async () => {
  const result = await callTool("get_project_summary", { id: CARCHIEF_ID });
  assertStringIncludes(result, "Child Projects");
  assertStringIncludes(result, "CarChief Backend");
});

Deno.test("get_project_summary shows parent project", async () => {
  const result = await callTool("get_project_summary", { id: CARCHIEF_BACKEND_ID });
  assertStringIncludes(result, "Parent:");
  assertStringIncludes(result, "CarChief");
});

Deno.test("get_project_summary shows open tasks for Terrestrial Brain", async () => {
  // Seed data has 2 open tasks and 1 done task for Terrestrial Brain
  const result = await callTool("get_project_summary", { id: TERRESTRIAL_BRAIN_ID });
  assertStringIncludes(result, "Open Tasks");
  assertStringIncludes(result, "Write migration files for new tables");
  assertStringIncludes(result, "Refactor edge function into modules");
});

Deno.test("get_project_summary shows thoughts with old-format references (project_id)", async () => {
  // Seed thought: "CarChief Backend needs Redis caching..." has references.project_id = CARCHIEF_ID
  const result = await callTool("get_project_summary", { id: CARCHIEF_ID });
  assertStringIncludes(result, "Recent Thoughts");
  assertStringIncludes(result, "Redis caching");
});

Deno.test("get_project_summary returns error for non-existent project", async () => {
  const result = await callToolRaw("get_project_summary", { id: "00000000-0000-0000-0000-999999999999" });
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "Project not found");
});

Deno.test("get_project_summary handles project with no tasks or thoughts", async () => {
  // Create a temporary empty project
  const createResult = await callTool("create_project", {
    name: "Empty Test Project",
    type: "personal",
    description: "Has no tasks or thoughts",
  });
  const match = createResult.match(/id: ([0-9a-f-]+)/);
  assertExists(match);
  const emptyProjectId = match![1];

  const result = await callTool("get_project_summary", { id: emptyProjectId });
  assertStringIncludes(result, "Empty Test Project");
  assertStringIncludes(result, "No open tasks");
  assertStringIncludes(result, "No recent thoughts");

  // Clean up
  await callTool("archive_project", { id: emptyProjectId });
});

// ─── get_recent_activity Tests ─────────────────────────────────────────────

Deno.test("get_recent_activity returns activity within default window", async () => {
  const result = await callTool("get_recent_activity", {});
  assertExists(result);
  assertStringIncludes(result, "Activity");
  // Should have section headers
  assertStringIncludes(result, "Thoughts");
  assertStringIncludes(result, "Tasks Created");
  assertStringIncludes(result, "Tasks Completed");
  assertStringIncludes(result, "Projects");
});

Deno.test("get_recent_activity shows seed data (created today)", async () => {
  // Seed data was inserted when emulators started, so it's within 1-day window
  const result = await callTool("get_recent_activity", { days: 1 });
  // Seed projects should appear
  assertStringIncludes(result, "CarChief");
  // Seed tasks should appear
  assertStringIncludes(result, "Tasks Created");
});

Deno.test("get_recent_activity with large window includes all data", async () => {
  const result = await callTool("get_recent_activity", { days: 365 });
  assertExists(result);
  assertStringIncludes(result, "Activity — Last 365 Days");
});

Deno.test("get_recent_activity clamps negative days to 1", async () => {
  const result = await callTool("get_recent_activity", { days: -5 });
  assertExists(result);
  assertStringIncludes(result, "Activity — Last 1 Day");
});

Deno.test("get_recent_activity clamps zero days to 1", async () => {
  const result = await callTool("get_recent_activity", { days: 0 });
  assertExists(result);
  assertStringIncludes(result, "Activity — Last 1 Day");
});

Deno.test("get_recent_activity shows tasks with project names", async () => {
  // Seed tasks are linked to Terrestrial Brain project
  const result = await callTool("get_recent_activity", { days: 1 });
  // At least the tasks section should have project associations
  assertStringIncludes(result, "Terrestrial Brain");
});
