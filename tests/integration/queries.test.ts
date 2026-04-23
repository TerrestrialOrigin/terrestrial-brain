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
  // Create a fresh task linked to Terrestrial Brain so it always appears in the 1-day window
  const TB_PROJECT_ID = "00000000-0000-0000-0000-000000000002";
  await callTool("create_task", {
    content: `recent-activity-project-name-test-${Date.now()}`,
    project_id: TB_PROJECT_ID,
  });

  const result = await callTool("get_recent_activity", { days: 1 });
  assertStringIncludes(result, "Terrestrial Brain");
});

// ─── Archived record exclusion tests ──────────────────────────────────────

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const ARCHIVE_QUERY_CLEANUP_IDS: { table: string; id: string }[] = [];

Deno.test("get_recent_activity excludes archived thoughts", async () => {
  // Capture a thought, archive it, then verify it doesn't appear in recent activity
  const uniqueContent = `Archived activity exclusion test ${Date.now()}`;
  await callTool("capture_thought", { content: uniqueContent, author: "test-archived-activity" });

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  const thoughts: { id: string }[] = await response.json();
  assertEquals(thoughts.length, 1);
  const thoughtId = thoughts[0].id;
  ARCHIVE_QUERY_CLEANUP_IDS.push({ table: "thoughts", id: thoughtId });

  // Archive it
  await callTool("archive_thought", { id: thoughtId });

  // Check get_recent_activity
  const result = await callTool("get_recent_activity", { days: 1 });
  assertEquals(
    result.includes(uniqueContent),
    false,
    `Archived thought should not appear in get_recent_activity. Got: ${result.substring(0, 500)}`,
  );
});

Deno.test("get_recent_activity excludes archived tasks", async () => {
  // Create a task, archive it, verify exclusion
  const taskContent = `Archived task activity test ${Date.now()}`;
  const createResult = await callTool("create_task", {
    content: taskContent,
    project_id: TERRESTRIAL_BRAIN_ID,
  });
  const taskMatch = createResult.match(/ID: ([0-9a-f-]+)/i) || createResult.match(/id: ([0-9a-f-]+)/i);
  assertExists(taskMatch, `Should have created a task. Got: ${createResult}`);
  const taskId = taskMatch![1];
  ARCHIVE_QUERY_CLEANUP_IDS.push({ table: "tasks", id: taskId });

  // Archive it
  await callTool("archive_task", { id: taskId });

  const result = await callTool("get_recent_activity", { days: 1 });
  assertEquals(
    result.includes(taskContent),
    false,
    `Archived task should not appear in get_recent_activity. Got: ${result.substring(0, 800)}`,
  );
});

Deno.test("get_recent_activity excludes archived projects", async () => {
  const projectName = `Archived project activity test ${Date.now()}`;
  const createResult = await callTool("create_project", {
    name: projectName,
    type: "personal",
  });
  const projectMatch = createResult.match(/id: ([0-9a-f-]+)/);
  assertExists(projectMatch, `Should have created a project. Got: ${createResult}`);
  const projectId = projectMatch![1];
  ARCHIVE_QUERY_CLEANUP_IDS.push({ table: "projects", id: projectId });

  // Archive it
  await callTool("archive_project", { id: projectId });

  const result = await callTool("get_recent_activity", { days: 1 });
  assertEquals(
    result.includes(projectName),
    false,
    `Archived project should not appear in get_recent_activity. Got: ${result.substring(0, 800)}`,
  );
});

Deno.test("get_recent_activity excludes archived people", async () => {
  const personName = `Archived person activity test ${Date.now()}`;
  const createResult = await callTool("create_person", {
    name: personName,
    type: "human",
  });
  const personMatch = createResult.match(/id: ([0-9a-f-]+)/i) || createResult.match(/ID: ([0-9a-f-]+)/i);
  assertExists(personMatch, `Should have created a person. Got: ${createResult}`);
  const personId = personMatch![1];
  ARCHIVE_QUERY_CLEANUP_IDS.push({ table: "people", id: personId });

  // Archive it
  await callTool("archive_person", { id: personId });

  const result = await callTool("get_recent_activity", { days: 1 });
  assertEquals(
    result.includes(personName),
    false,
    `Archived person should not appear in get_recent_activity. Got: ${result.substring(0, 800)}`,
  );
});

Deno.test("get_project_summary excludes archived thoughts", async () => {
  // Capture a thought linked to TB project, archive it, verify it's excluded from summary
  const uniqueContent = `Archived summary exclusion test ${Date.now()}`;
  await callTool("capture_thought", {
    content: uniqueContent,
    author: "test-archived-summary",
    project_ids: [TERRESTRIAL_BRAIN_ID],
  });

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  const thoughts: { id: string }[] = await response.json();
  assertEquals(thoughts.length, 1);
  ARCHIVE_QUERY_CLEANUP_IDS.push({ table: "thoughts", id: thoughts[0].id });

  // Archive it
  await callTool("archive_thought", { id: thoughts[0].id });

  const result = await callTool("get_project_summary", { id: TERRESTRIAL_BRAIN_ID });
  assertEquals(
    result.includes(uniqueContent),
    false,
    `Archived thought should not appear in get_project_summary. Got: ${result.substring(0, 800)}`,
  );
});

Deno.test("cleanup archive query test data", async () => {
  for (const entry of ARCHIVE_QUERY_CLEANUP_IDS) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${entry.table}?id=eq.${entry.id}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    assertEquals(response.ok, true, `Cleanup of ${entry.table}/${entry.id} should succeed`);
  }
});
