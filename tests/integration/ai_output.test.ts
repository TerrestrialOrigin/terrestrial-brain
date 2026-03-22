import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateTaskMarkdown } from "../../supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts";

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

// ─── AI Output Tests ────────────────────────────────────────────────────────

let createdOutputId: string;

Deno.test("create_ai_output creates output with explicit file_path", async () => {
  const result = await callTool("create_ai_output", {
    title: "Test Sprint Plan",
    content: "# Sprint Plan\n\n- [ ] Task 1\n- [ ] Task 2",
    file_path: "projects/TestProject/sprint-plan.md",
    source_context: "Integration test",
  });
  assertExists(result);
  assertEquals(result.includes("Test Sprint Plan"), true);
  assertEquals(result.includes("projects/TestProject/sprint-plan.md"), true);
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain output id");
  createdOutputId = match![1];
});

Deno.test("create_ai_output stores content as-is (no frontmatter injection)", async () => {
  const rawContent = "# No Frontmatter\n\nJust plain markdown.";
  const result = await callTool("create_ai_output", {
    title: "Plain Content Test",
    content: rawContent,
    file_path: "test/plain-content.md",
  });
  assertExists(result);

  // Verify via get_pending that content is stored exactly as provided
  const pending = await callTool("get_pending_ai_output", {});
  const outputs = JSON.parse(pending);
  const found = outputs.find((output: { title: string }) => output.title === "Plain Content Test");
  assertExists(found, "Should find the plain content output in pending list");
  assertEquals(found.content, rawContent, "Content should be stored exactly as provided — no frontmatter injected");
});

Deno.test("get_pending_ai_output shows unpicked output", async () => {
  const result = await callTool("get_pending_ai_output", {});
  const outputs = JSON.parse(result);
  assertEquals(Array.isArray(outputs), true);

  const testOutput = outputs.find((output: { id: string }) => output.id === createdOutputId);
  assertExists(testOutput, "Created output should appear in pending list");
  assertEquals(testOutput.title, "Test Sprint Plan");
  assertEquals(testOutput.file_path, "projects/TestProject/sprint-plan.md");
  assertEquals(testOutput.content.includes("- [ ] Task 1"), true);
});

Deno.test("mark_ai_output_picked_up marks output", async () => {
  const result = await callTool("mark_ai_output_picked_up", { ids: [createdOutputId] });
  assertExists(result);
  assertEquals(result.includes("1 output"), true);
});

Deno.test("get_pending_ai_output hides picked-up output", async () => {
  const result = await callTool("get_pending_ai_output", {});
  const outputs = JSON.parse(result);
  const testOutput = outputs.find((output: { id: string }) => output.id === createdOutputId);
  assertEquals(testOutput, undefined, "Picked-up output should not appear in pending list");
});

Deno.test("create_ai_output with nested path preserves file_path", async () => {
  const result = await callTool("create_ai_output", {
    title: "Deeply Nested Output",
    content: "# Nested\n\nSome content.",
    file_path: "projects/CarChief/sprints/2026/march/deep-plan.md",
  });
  assertExists(result);
  assertEquals(result.includes("projects/CarChief/sprints/2026/march/deep-plan.md"), true);

  // Verify the file_path is preserved in the pending output
  const pending = await callTool("get_pending_ai_output", {});
  const outputs = JSON.parse(pending);
  const nested = outputs.find((output: { title: string }) => output.title === "Deeply Nested Output");
  assertExists(nested, "Nested output should appear in pending list");
  assertEquals(nested.file_path, "projects/CarChief/sprints/2026/march/deep-plan.md");

  // Clean up
  await callTool("mark_ai_output_picked_up", { ids: [nested.id] });
});

// ─── generateTaskMarkdown Unit Tests ─────────────────────────────────────────

Deno.test("generateTaskMarkdown: basic tasks produce correct checkbox markdown", () => {
  const markdown = generateTaskMarkdown(
    "Sprint Tasks",
    [
      { content: "Fix login page", status: "open" },
      { content: "Update docs", status: "open" },
      { content: "Deploy staging", status: "done" },
    ],
    {},
  );

  assertEquals(markdown.includes("# Sprint Tasks"), true);
  assertEquals(markdown.includes("- [ ] Fix login page"), true);
  assertEquals(markdown.includes("- [ ] Update docs"), true);
  assertEquals(markdown.includes("- [x] Deploy staging"), true);
});

Deno.test("generateTaskMarkdown: project headings when project names available", () => {
  const projectNameMap = {
    "proj-1": "CarChief",
    "proj-2": "Terrestrial Brain",
  };
  const markdown = generateTaskMarkdown(
    "Multi-Project Tasks",
    [
      { content: "Task for CarChief", project_id: "proj-1", status: "open" },
      { content: "Task for TB", project_id: "proj-2", status: "open" },
    ],
    projectNameMap,
  );

  assertEquals(markdown.includes("## CarChief"), true, "Should have CarChief heading");
  assertEquals(markdown.includes("## Terrestrial Brain"), true, "Should have TB heading");
  assertEquals(markdown.includes("- [ ] Task for CarChief"), true);
  assertEquals(markdown.includes("- [ ] Task for TB"), true);
});

Deno.test("generateTaskMarkdown: subtask indentation", () => {
  const markdown = generateTaskMarkdown(
    "Hierarchy Test",
    [
      { content: "Parent", status: "open" },
      { content: "Child", parent_index: 0, status: "open" },
      { content: "Grandchild", parent_index: 1, status: "open" },
    ],
    {},
  );

  assertEquals(markdown.includes("- [ ] Parent"), true);
  assertEquals(markdown.includes("  - [ ] Child"), true);
  assertEquals(markdown.includes("    - [ ] Grandchild"), true);
});

Deno.test("generateTaskMarkdown: single task produces valid markdown", () => {
  const markdown = generateTaskMarkdown(
    "Single Task",
    [{ content: "The only task", status: "open" }],
    {},
  );

  assertEquals(markdown.includes("# Single Task"), true);
  assertEquals(markdown.includes("- [ ] The only task"), true);
});

Deno.test("generateTaskMarkdown: tasks without project_id have no project heading", () => {
  const markdown = generateTaskMarkdown(
    "No Project",
    [
      { content: "Orphan task 1", status: "open" },
      { content: "Orphan task 2", status: "done" },
    ],
    {},
  );

  assertEquals(markdown.includes("##"), false, "Should have no H2 headings");
  assertEquals(markdown.includes("- [ ] Orphan task 1"), true);
  assertEquals(markdown.includes("- [x] Orphan task 2"), true);
});

// Clean up the "Plain Content Test" output
Deno.test("cleanup: mark remaining test outputs as picked up", async () => {
  const pending = await callTool("get_pending_ai_output", {});
  const outputs = JSON.parse(pending);
  const testOutputs = outputs.filter((output: { title: string }) =>
    output.title === "Plain Content Test"
  );
  if (testOutputs.length > 0) {
    const ids = testOutputs.map((output: { id: string }) => output.id);
    await callTool("mark_ai_output_picked_up", { ids });
  }
});
