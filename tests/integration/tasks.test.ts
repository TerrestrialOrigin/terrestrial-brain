import { assertEquals, assertExists } from "@std/assert";
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

    const result = await callTool("update_task", {
      id: taskId,
      status: "done",
    });
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

// TOOL-10 — reconcile_tasks bounds its open-task set and reports truncation when
// more than RECONCILE_TASK_LIMIT (100) open tasks exist. Self-owned fixtures:
// bulk-insert 101 open tasks under a unique project, then delete them.
Deno.test("reconcile_tasks reports truncation past the cap", async () => {
  const marker = uniqueName("reconcile-cap");
  // A dedicated project so the probe is deterministic regardless of seed data.
  const projectResponse = await fetch(restUrl("projects"), {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    }),
    body: JSON.stringify({ name: marker, type: "test" }),
  });
  const [project] = await projectResponse.json();
  const projectId = project.id as string;
  try {
    const rows = Array.from({ length: 101 }, (_unused, index) => ({
      content: `${marker}-${index}`,
      status: "open",
      project_id: projectId,
    }));
    const insertResponse = await fetch(restUrl("tasks"), {
      method: "POST",
      headers: serviceHeaders({
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      }),
      body: JSON.stringify(rows),
    });
    const insertOk = insertResponse.ok;
    await insertResponse.body?.cancel();
    assertEquals(insertOk, true, "bulk task insert must succeed");

    const result = await callTool("reconcile_tasks", { project_id: projectId });
    assertEquals(
      result.includes("more") && result.includes("Narrow by project_id"),
      true,
      `reconcile_tasks must report truncation past the cap. Got: ${result}`,
    );
  } finally {
    const taskDelete = await fetch(
      restUrl(`tasks?project_id=eq.${projectId}`),
      {
        method: "DELETE",
        headers: serviceHeaders(),
      },
    );
    await taskDelete.body?.cancel();
    const projectDelete = await fetch(restUrl(`projects?id=eq.${projectId}`), {
      method: "DELETE",
      headers: serviceHeaders(),
    });
    await projectDelete.body?.cancel();
  }
});
