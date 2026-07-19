// Integration coverage for create_ai_output + the pull-API flow and the
// create_tasks_with_output atomicity rules. Every test owns its fixtures
// (TEST-9/10): unique titles/paths, ids registered before assertions, hard
// deletes in try/finally. The generateTaskMarkdown pure-function tests moved
// to tests/unit/generate-task-markdown.test.ts (TEST-14).

import { assertEquals, assertExists } from "@std/assert";
import {
  callHTTP,
  callTool,
  callToolRaw,
  restUrl,
  serviceHeaders,
  uniqueName,
  uniqueToken,
} from "../helpers/mcp-client.ts";

/** Extracts the `id: <uuid>` from a tool confirmation. */
function extractId(result: string): string {
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, `Response should contain an id. Got: ${result}`);
  return match![1];
}

/** Per-test ai_output fixture tracker with hard-delete cleanup (TEST-16). */
function makeOutputFixtures() {
  const outputIds: string[] = [];
  return {
    outputIds,
    async cleanup(): Promise<void> {
      for (const outputId of outputIds) {
        const response = await fetch(restUrl(`ai_output?id=eq.${outputId}`), {
          method: "DELETE",
          headers: serviceHeaders(),
        });
        await response.body?.cancel();
      }
    },
  };
}

// ─── create_ai_output + pull-flow Tests ─────────────────────────────────────

Deno.test("create_ai_output creates output with explicit file_path; pending shows it; pickup hides it", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const title = uniqueName("Test Sprint Plan");
    const filePath = `projects/TestProject/sprint-plan-${uniqueToken()}.md`;
    const result = await callTool("create_ai_output", {
      title,
      content: "# Sprint Plan\n\n- [ ] Task 1\n- [ ] Task 2",
      file_path: filePath,
      source_context: "Integration test",
    });
    const outputId = extractId(result);
    fixtures.outputIds.push(outputId);
    assertEquals(result.includes(title), true);
    assertEquals(result.includes(filePath), true);

    // Pending shows the unpicked output with its stored fields.
    const pending = await callHTTP("get-pending-ai-output");
    const outputs = pending.data as {
      id: string;
      title: string;
      file_path: string;
      content: string;
    }[];
    const testOutput = outputs.find((output) => output.id === outputId);
    assertExists(testOutput, "Created output should appear in pending list");
    assertEquals(testOutput.title, title);
    assertEquals(testOutput.file_path, filePath);
    assertEquals(testOutput.content.includes("- [ ] Task 1"), true);

    // Marking picked up removes it from pending.
    const markResult = await callHTTP("mark-ai-output-picked-up", {
      ids: [outputId],
    });
    assertEquals(markResult.success, true);
    assertEquals((markResult.message as string).includes("1 output"), true);

    const afterPickup = await callHTTP("get-pending-ai-output");
    const remaining = afterPickup.data as { id: string }[];
    assertEquals(
      remaining.find((output) => output.id === outputId),
      undefined,
      "Picked-up output should not appear in pending list",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("create_ai_output stores content as-is (no frontmatter injection)", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const rawContent = "# No Frontmatter\n\nJust plain markdown.";
    const title = uniqueName("Plain Content Test");
    const result = await callTool("create_ai_output", {
      title,
      content: rawContent,
      file_path: `test/plain-content-${uniqueToken()}.md`,
    });
    const outputId = extractId(result);
    fixtures.outputIds.push(outputId);

    const pending = await callHTTP("get-pending-ai-output");
    const outputs = pending.data as { id: string; content: string }[];
    const found = outputs.find((output) => output.id === outputId);
    assertExists(found, "Should find the plain content output in pending list");
    assertEquals(
      found.content,
      rawContent,
      "Content should be stored exactly as provided — no frontmatter injected",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("create_ai_output with nested path preserves file_path", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const filePath =
      `projects/Test Proj/sprints/2026/march/deep-plan-${uniqueToken()}.md`;
    const result = await callTool("create_ai_output", {
      title: uniqueName("Deeply Nested Output"),
      content: "# Nested\n\nSome content.",
      file_path: filePath,
    });
    const outputId = extractId(result);
    fixtures.outputIds.push(outputId);
    assertEquals(result.includes(filePath), true);

    const pending = await callHTTP("get-pending-ai-output");
    const outputs = pending.data as { id: string; file_path: string }[];
    const nested = outputs.find((output) => output.id === outputId);
    assertExists(nested, "Nested output should appear in pending list");
    assertEquals(nested.file_path, filePath);
  } finally {
    await fixtures.cleanup();
  }
});

// ─── get_pending_ai_output_metadata Tests ─────────────────────────────────────

Deno.test("get-pending-ai-output-metadata HTTP: returns metadata without content body; pickup filters it out", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const title = uniqueName("Metadata Test Output");
    const filePath = `test/metadata-test-${uniqueToken()}.md`;
    const createResult = await callTool("create_ai_output", {
      title,
      content: "Hello, world!", // 13 bytes in UTF-8
      file_path: filePath,
    });
    const outputId = extractId(createResult);
    fixtures.outputIds.push(outputId);

    const result = await callHTTP("get-pending-ai-output-metadata");
    assertEquals(result.success, true);
    const outputs = result.data as {
      id: string;
      title: string;
      file_path: string;
      content_size: number;
      content?: string;
      created_at: string;
    }[];
    assertEquals(Array.isArray(outputs), true);

    const found = outputs.find((output) => output.id === outputId);
    assertExists(found, "Should find test output in metadata list");
    assertEquals(found.title, title);
    assertEquals(found.file_path, filePath);
    assertEquals(typeof found.content_size, "number");
    assertEquals(
      found.content_size,
      13,
      "content_size should be byte length of 'Hello, world!'",
    );
    assertEquals(
      found.content,
      undefined,
      "content body should NOT be present in metadata response",
    );
    assertExists(found.created_at, "created_at should be present");

    // Picked-up outputs are filtered out of the metadata list.
    await callHTTP("mark-ai-output-picked-up", { ids: [outputId] });
    const afterPickup = await callHTTP("get-pending-ai-output-metadata");
    const remaining = afterPickup.data as { id: string }[];
    assertEquals(
      remaining.find((output) => output.id === outputId),
      undefined,
      "Picked-up output should not appear in metadata list",
    );
  } finally {
    await fixtures.cleanup();
  }
});

// SQL-3 — get_pending_ai_output_metadata respects an explicit max_rows bound
// instead of PostgREST's silent 1000-row truncation. Self-owned fixtures.
Deno.test("get_pending_ai_output_metadata: caps at max_rows", async () => {
  const marker = uniqueName("bounded-metadata");
  const seededIds: string[] = [];
  try {
    for (let index = 0; index < 3; index++) {
      const insertResponse = await fetch(restUrl("ai_output"), {
        method: "POST",
        headers: serviceHeaders({
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        }),
        body: JSON.stringify({
          title: `${marker}-${index}`,
          content: "body",
          file_path: `test/${marker}-${index}.md`,
          picked_up: false,
          rejected: false,
        }),
      });
      const [row] = await insertResponse.json();
      seededIds.push(row.id as string);
    }

    const rpcResponse = await fetch(
      restUrl("rpc/get_pending_ai_output_metadata"),
      {
        method: "POST",
        headers: serviceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ max_rows: 2 }),
      },
    );
    const rows = await rpcResponse.json();
    assertEquals(rpcResponse.ok, true, JSON.stringify(rows));
    assertEquals(
      rows.length <= 2,
      true,
      `max_rows=2 must return at most 2 rows, got ${rows.length}`,
    );
  } finally {
    for (const id of seededIds) {
      await fetch(restUrl(`ai_output?id=eq.${id}`), {
        method: "DELETE",
        headers: serviceHeaders(),
      });
    }
  }
});

// ─── fetch_ai_output_content Tests ────────────────────────────────────────────

Deno.test("fetch-ai-output-content HTTP: returns content for valid pending IDs, empty once picked up", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const createResult = await callTool("create_ai_output", {
      title: uniqueName("Fetch Test Output"),
      content: "# Fetch Content\n\nThis is the full body.",
      file_path: `test/fetch-test-${uniqueToken()}.md`,
    });
    const outputId = extractId(createResult);
    fixtures.outputIds.push(outputId);

    const result = await callHTTP("fetch-ai-output-content", {
      ids: [outputId],
    });
    assertEquals(result.success, true);
    const items = result.data as { id: string; content: string }[];
    assertEquals(items.length, 1);
    assertEquals(items[0].id, outputId);
    assertEquals(items[0].content, "# Fetch Content\n\nThis is the full body.");

    // Once picked up, the same id is no longer fetchable.
    await callHTTP("mark-ai-output-picked-up", { ids: [outputId] });
    const afterPickup = await callHTTP("fetch-ai-output-content", {
      ids: [outputId],
    });
    assertEquals(
      (afterPickup.data as unknown[]).length,
      0,
      "Should return empty array for picked-up output",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("fetch-ai-output-content HTTP: returns empty for rejected IDs", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const createResult = await callTool("create_ai_output", {
      title: uniqueName("Reject Test Output"),
      content: "Rejected content",
      file_path: `test/reject-test-${uniqueToken()}.md`,
    });
    const outputId = extractId(createResult);
    fixtures.outputIds.push(outputId);

    await callHTTP("reject-ai-output", { ids: [outputId] });

    const result = await callHTTP("fetch-ai-output-content", {
      ids: [outputId],
    });
    assertEquals(
      (result.data as unknown[]).length,
      0,
      "Should return empty array for rejected output",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("fetch-ai-output-content HTTP: returns empty for non-existent IDs", async () => {
  const result = await callHTTP("fetch-ai-output-content", {
    ids: ["00000000-0000-0000-0000-000000000000"],
  });
  assertEquals(
    (result.data as unknown[]).length,
    0,
    "Should return empty array for non-existent IDs",
  );
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
      `tasks?reference_id=eq.${
        encodeURIComponent(filePath)
      }&select=id,content,parent_id`,
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

/** create_tasks_with_output also writes an ai_output row — clean it up too (TEST-16). */
async function deleteOutputsByReferenceId(filePath: string): Promise<void> {
  await fetch(
    restUrl(`ai_output?file_path=eq.${encodeURIComponent(filePath)}`),
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
    await deleteOutputsByReferenceId(filePath);
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
          {
            content: `Task with ${testCase.label} parent_index`,
            parent_index: testCase.parent_index,
          },
        ],
      });
      assertEquals(
        isError,
        true,
        `${testCase.label} parent_index must be rejected`,
      );
      const rows = await tasksByReferenceId(filePath);
      assertEquals(
        rows.length,
        0,
        `${testCase.label}: no rows should be created`,
      );
    } finally {
      await deleteTasksByReferenceId(filePath);
      await deleteOutputsByReferenceId(filePath);
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
        {
          content: "Task with bad assignee",
          assigned_to: "00000000-0000-0000-0000-000000000000",
        },
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
    await deleteOutputsByReferenceId(filePath);
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
    assertEquals(
      grandchild.parent_id,
      child.id,
      "Grandchild links to child's DB id",
    );
  } finally {
    await deleteTasksByReferenceId(filePath);
    await deleteOutputsByReferenceId(filePath);
  }
});
