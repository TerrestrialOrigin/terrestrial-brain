import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateTaskMarkdown } from "../../supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts";
import {
  callHTTP,
  callTool,
  callToolRaw,
  restUrl,
  serviceHeaders,
  uniqueName,
} from "../helpers/mcp-client.ts";

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

  // Verify via HTTP get-pending-ai-output that content is stored exactly as provided
  const pending = await callHTTP("get-pending-ai-output");
  const outputs = pending.data as { title: string; content: string }[];
  const found = outputs.find((output) => output.title === "Plain Content Test");
  assertExists(found, "Should find the plain content output in pending list");
  assertEquals(found.content, rawContent, "Content should be stored exactly as provided — no frontmatter injected");
});

Deno.test("get-pending-ai-output HTTP shows unpicked output", async () => {
  const result = await callHTTP("get-pending-ai-output");
  const outputs = result.data as { id: string; title: string; file_path: string; content: string }[];
  assertEquals(Array.isArray(outputs), true);

  const testOutput = outputs.find((output) => output.id === createdOutputId);
  assertExists(testOutput, "Created output should appear in pending list");
  assertEquals(testOutput.title, "Test Sprint Plan");
  assertEquals(testOutput.file_path, "projects/TestProject/sprint-plan.md");
  assertEquals(testOutput.content.includes("- [ ] Task 1"), true);
});

Deno.test("mark-ai-output-picked-up HTTP marks output", async () => {
  const result = await callHTTP("mark-ai-output-picked-up", { ids: [createdOutputId] });
  assertEquals(result.success, true);
  assertEquals((result.message as string).includes("1 output"), true);
});

Deno.test("get-pending-ai-output HTTP hides picked-up output", async () => {
  const result = await callHTTP("get-pending-ai-output");
  const outputs = result.data as { id: string }[];
  const testOutput = outputs.find((output) => output.id === createdOutputId);
  assertEquals(testOutput, undefined, "Picked-up output should not appear in pending list");
});

Deno.test("create_ai_output with nested path preserves file_path", async () => {
  const result = await callTool("create_ai_output", {
    title: "Deeply Nested Output",
    content: "# Nested\n\nSome content.",
    file_path: "projects/Test Proj/sprints/2026/march/deep-plan.md",
  });
  assertExists(result);
  assertEquals(result.includes("projects/Test Proj/sprints/2026/march/deep-plan.md"), true);

  // Verify the file_path is preserved in the pending output
  const pending = await callHTTP("get-pending-ai-output");
  const outputs = pending.data as { id: string; title: string; file_path: string }[];
  const nested = outputs.find((output) => output.title === "Deeply Nested Output");
  assertExists(nested, "Nested output should appear in pending list");
  assertEquals(nested.file_path, "projects/Test Proj/sprints/2026/march/deep-plan.md");

  // Clean up
  await callHTTP("mark-ai-output-picked-up", { ids: [nested.id] });
});

// ─── get_pending_ai_output_metadata Tests ─────────────────────────────────────

let metadataTestOutputId: string;

Deno.test("get_pending_ai_output_metadata: create test output for metadata tests", async () => {
  const result = await callTool("create_ai_output", {
    title: "Metadata Test Output",
    content: "Hello, world!",  // 13 bytes in UTF-8
    file_path: "test/metadata-test.md",
  });
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain output id");
  metadataTestOutputId = match![1];
});

Deno.test("get-pending-ai-output-metadata HTTP: returns metadata without content body", async () => {
  const result = await callHTTP("get-pending-ai-output-metadata");
  assertEquals(result.success, true);
  const outputs = result.data as { id: string; title: string; file_path: string; content_size: number; content?: string; created_at: string }[];
  assertEquals(Array.isArray(outputs), true);

  const found = outputs.find((output) => output.id === metadataTestOutputId);
  assertExists(found, "Should find test output in metadata list");
  assertEquals(found.title, "Metadata Test Output");
  assertEquals(found.file_path, "test/metadata-test.md");
  assertEquals(typeof found.content_size, "number");
  assertEquals(found.content_size, 13, "content_size should be byte length of 'Hello, world!'");
  assertEquals(found.content, undefined, "content body should NOT be present in metadata response");
  assertExists(found.created_at, "created_at should be present");
});

Deno.test("get-pending-ai-output-metadata HTTP: filters out picked-up outputs", async () => {
  // Mark the test output as picked up
  await callHTTP("mark-ai-output-picked-up", { ids: [metadataTestOutputId] });

  const result = await callHTTP("get-pending-ai-output-metadata");
  const outputs = result.data as { id: string }[];
  const found = outputs.find((output) => output.id === metadataTestOutputId);
  assertEquals(found, undefined, "Picked-up output should not appear in metadata list");
});

// ─── fetch_ai_output_content Tests ────────────────────────────────────────────

let fetchTestOutputId: string;

Deno.test("fetch_ai_output_content: create test output for fetch tests", async () => {
  const result = await callTool("create_ai_output", {
    title: "Fetch Test Output",
    content: "# Fetch Content\n\nThis is the full body.",
    file_path: "test/fetch-test.md",
  });
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain output id");
  fetchTestOutputId = match![1];
});

Deno.test("fetch-ai-output-content HTTP: returns content for valid pending IDs", async () => {
  const result = await callHTTP("fetch-ai-output-content", { ids: [fetchTestOutputId] });
  assertEquals(result.success, true);
  const items = result.data as { id: string; content: string }[];
  assertEquals(Array.isArray(items), true);
  assertEquals(items.length, 1);
  assertEquals(items[0].id, fetchTestOutputId);
  assertEquals(items[0].content, "# Fetch Content\n\nThis is the full body.");
});

Deno.test("fetch-ai-output-content HTTP: returns empty for already-picked-up IDs", async () => {
  // Mark as picked up
  await callHTTP("mark-ai-output-picked-up", { ids: [fetchTestOutputId] });

  const result = await callHTTP("fetch-ai-output-content", { ids: [fetchTestOutputId] });
  const items = result.data as unknown[];
  assertEquals(items.length, 0, "Should return empty array for picked-up output");
});

let rejectTestOutputId: string;

Deno.test("fetch-ai-output-content HTTP: returns empty for rejected IDs", async () => {
  // Create and then reject an output
  const createResult = await callTool("create_ai_output", {
    title: "Reject Test Output",
    content: "Rejected content",
    file_path: "test/reject-test.md",
  });
  const match = createResult.match(/id: ([0-9a-f-]+)/);
  assertExists(match);
  rejectTestOutputId = match![1];

  await callHTTP("reject-ai-output", { ids: [rejectTestOutputId] });

  const result = await callHTTP("fetch-ai-output-content", { ids: [rejectTestOutputId] });
  const items = result.data as unknown[];
  assertEquals(items.length, 0, "Should return empty array for rejected output");
});

Deno.test("fetch-ai-output-content HTTP: returns empty for non-existent IDs", async () => {
  const result = await callHTTP("fetch-ai-output-content", { ids: ["00000000-0000-0000-0000-000000000000"] });
  const items = result.data as unknown[];
  assertEquals(items.length, 0, "Should return empty array for non-existent IDs");
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
    "proj-1": "Test Proj",
    "proj-2": "Terrestrial Brain",
  };
  const markdown = generateTaskMarkdown(
    "Multi-Project Tasks",
    [
      { content: "Task for Test Proj", project_id: "proj-1", status: "open" },
      { content: "Task for TB", project_id: "proj-2", status: "open" },
    ],
    projectNameMap,
  );

  assertEquals(markdown.includes("## Test Proj"), true, "Should have Test Proj heading");
  assertEquals(markdown.includes("## Terrestrial Brain"), true, "Should have TB heading");
  assertEquals(markdown.includes("- [ ] Task for Test Proj"), true);
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

// ─── create_tasks_with_output: atomicity & parent_index validation (C4) ──────
//
// Each test owns a unique `file_path` (stored as the tasks' `reference_id`) and
// cleans up any rows it created in `finally`, so the tests are order-independent.

interface TaskRow {
  id: string;
  content: string;
  parent_id: string | null;
}

/** Fetch the task rows created for a given file_path (reference_id) via REST. */
async function tasksByReferenceId(filePath: string): Promise<TaskRow[]> {
  const res = await fetch(
    restUrl(
      `tasks?reference_id=eq.${encodeURIComponent(filePath)}&select=id,content,parent_id`,
    ),
    { headers: serviceHeaders() },
  );
  return (await res.json()) as TaskRow[];
}

async function deleteTasksByReferenceId(filePath: string): Promise<void> {
  await fetch(
    restUrl(`tasks?reference_id=eq.${encodeURIComponent(filePath)}`),
    { method: "DELETE", headers: serviceHeaders() },
  );
}

Deno.test("create_tasks_with_output: forward parent_index is rejected, zero rows created", async () => {
  const filePath = `test/atomic/${uniqueName("forward-ref")}.md`;
  try {
    // Child (index 0) references parent at index 1, which is inserted later.
    const { text, isError } = await callToolRaw("create_tasks_with_output", {
      title: "Forward Ref",
      file_path: filePath,
      tasks: [
        { content: "Child references later parent", parent_index: 1 },
        { content: "The parent" },
      ],
    });

    assertEquals(isError, true, "Forward parent_index must be rejected");
    assertEquals(
      /parent_index/i.test(text),
      true,
      "Error should mention parent_index",
    );

    const rows = await tasksByReferenceId(filePath);
    assertEquals(rows.length, 0, "No task rows should be created on rejection");
  } finally {
    await deleteTasksByReferenceId(filePath);
  }
});

Deno.test("create_tasks_with_output: self/out-of-range/negative parent_index rejected, zero rows", async () => {
  const cases: { label: string; parent_index: number }[] = [
    { label: "self", parent_index: 0 },
    { label: "out-of-range", parent_index: 5 },
    { label: "negative", parent_index: -1 },
  ];
  for (const testCase of cases) {
    const filePath = `test/atomic/${uniqueName(testCase.label)}.md`;
    try {
      const { isError } = await callToolRaw("create_tasks_with_output", {
        title: `Bad parent_index: ${testCase.label}`,
        file_path: filePath,
        tasks: [
          { content: `Task with ${testCase.label} parent_index`, parent_index: testCase.parent_index },
        ],
      });
      assertEquals(isError, true, `${testCase.label} parent_index must be rejected`);
      const rows = await tasksByReferenceId(filePath);
      assertEquals(rows.length, 0, `${testCase.label}: no rows should be created`);
    } finally {
      await deleteTasksByReferenceId(filePath);
    }
  }
});

Deno.test("create_tasks_with_output: mid-loop insert failure rolls back prior inserts", async () => {
  const filePath = `test/atomic/${uniqueName("mid-loop-fail")}.md`;
  try {
    // Tasks 0 and 1 are valid; task 2 has a non-existent assigned_to (FK to
    // people), so its insert fails after 0 and 1 have already been inserted.
    const { isError } = await callToolRaw("create_tasks_with_output", {
      title: "Mid-loop failure",
      file_path: filePath,
      tasks: [
        { content: "Valid task A" },
        { content: "Valid task B" },
        { content: "Task with bad assignee", assigned_to: "00000000-0000-0000-0000-000000000000" },
      ],
    });

    assertEquals(isError, true, "Insert failure must return an error");

    const rows = await tasksByReferenceId(filePath);
    assertEquals(
      rows.length,
      0,
      "All already-inserted tasks must be rolled back on mid-loop failure",
    );
  } finally {
    await deleteTasksByReferenceId(filePath);
  }
});

Deno.test("create_tasks_with_output: valid backward parent_index preserves hierarchy", async () => {
  const filePath = `test/atomic/${uniqueName("valid-hierarchy")}.md`;
  try {
    const result = await callTool("create_tasks_with_output", {
      title: "Valid Hierarchy",
      file_path: filePath,
      tasks: [
        { content: "Parent task" },
        { content: "Child task", parent_index: 0 },
        { content: "Grandchild task", parent_index: 1 },
      ],
    });
    assertEquals(result.includes("Created 3 task(s)"), true);

    const rows = await tasksByReferenceId(filePath);
    assertEquals(rows.length, 3, "All three tasks should be created");

    const byContent = new Map(rows.map((row) => [row.content, row]));
    const parent = byContent.get("Parent task")!;
    const child = byContent.get("Child task")!;
    const grandchild = byContent.get("Grandchild task")!;
    assertExists(parent);
    assertExists(child);
    assertExists(grandchild);
    assertEquals(parent.parent_id, null, "Parent has no parent_id");
    assertEquals(child.parent_id, parent.id, "Child links to parent's DB id");
    assertEquals(grandchild.parent_id, child.id, "Grandchild links to child's DB id");
  } finally {
    await deleteTasksByReferenceId(filePath);
  }
});

// Clean up the "Plain Content Test" output
Deno.test("cleanup: mark remaining test outputs as picked up", async () => {
  const pending = await callHTTP("get-pending-ai-output");
  const outputs = pending.data as { id: string; title: string }[];
  const testOutputs = outputs.filter((output) =>
    output.title === "Plain Content Test"
  );
  if (testOutputs.length > 0) {
    const ids = testOutputs.map((output) => output.id);
    await callHTTP("mark-ai-output-picked-up", { ids });
  }
});
