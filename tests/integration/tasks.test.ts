import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  callTool,
  restUrl,
  serviceHeaders,
  uniqueName,
} from "../helpers/mcp-client.ts";

// ─── Task Tests ──────────────────────────────────────────────────────────────
//
// Each test owns its own uniquely-named fixtures and deletes them in `finally`
// so tests are order-independent and never leave rows accumulating across runs.

const SEED_PROJECT_ID = "00000000-0000-0000-0000-000000000002"; // Terrestrial Brain

function taskIdFrom(result: string): string {
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain task id");
  return match![1];
}

async function deleteTasks(ids: string[]): Promise<void> {
  for (const id of ids) {
    await fetch(restUrl(`tasks?id=eq.${id}`), {
      method: "DELETE",
      headers: serviceHeaders(),
    });
  }
}

Deno.test("create_task creates a task and list_tasks shows it", async () => {
  const content = uniqueName("Integration test task");
  const created: string[] = [];
  try {
    const result = await callTool("create_task", {
      content,
      project_id: SEED_PROJECT_ID,
    });
    assertExists(result);
    created.push(taskIdFrom(result));

    const list = await callTool("list_tasks", { project_id: SEED_PROJECT_ID });
    assertExists(list);
    assertEquals(list.includes(content), true);
  } finally {
    await deleteTasks(created);
  }
});

Deno.test("update_task to done archives it and hides it from list by default", async () => {
  const content = uniqueName("Task to complete");
  const created: string[] = [];
  try {
    const createResult = await callTool("create_task", {
      content,
      project_id: SEED_PROJECT_ID,
    });
    const taskId = taskIdFrom(createResult);
    created.push(taskId);

    const result = await callTool("update_task", { id: taskId, status: "done" });
    assertExists(result);
    assertEquals(result.includes("status"), true);
    assertEquals(result.includes("archived_at"), true);

    const list = await callTool("list_tasks", { project_id: SEED_PROJECT_ID });
    assertEquals(
      list.includes(content),
      false,
      "A done/archived task should be hidden from list_tasks by default",
    );
  } finally {
    await deleteTasks(created);
  }
});

Deno.test("create_task and archive_task works", async () => {
  const content = uniqueName("Task to archive");
  const created: string[] = [];
  try {
    const createResult = await callTool("create_task", { content });
    const taskId = taskIdFrom(createResult);
    created.push(taskId);

    const archiveResult = await callTool("archive_task", { id: taskId });
    assertEquals(archiveResult.includes("archived"), true);
  } finally {
    await deleteTasks(created);
  }
});
