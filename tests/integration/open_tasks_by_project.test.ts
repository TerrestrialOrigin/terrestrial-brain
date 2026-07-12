import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  callTool,
  restUrl,
  serviceHeaders,
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
  uniqueName,
} from "../helpers/mcp-client.ts";

// Integration coverage for list_open_tasks_by_project (New-Feature-Plan follow-up).
// Real local stack, real handler → repository → Postgres path, no mocks. Each test
// owns uniquely-named fixtures and deletes them in `finally` so it is
// order-independent and leaves no rows behind.

const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
};

function taskIdFrom(result: string): string {
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain task id");
  return match![1];
}

async function createProject(name: string): Promise<string> {
  const id = crypto.randomUUID();
  const res = await fetch(restUrl("projects"), {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ id, name, type: "personal" }),
  });
  if (!res.ok) {
    throw new Error(`project insert failed: ${res.status} ${await res.text()}`);
  }
  await res.body?.cancel();
  return id;
}

async function deleteTasks(ids: string[]): Promise<void> {
  for (const id of ids) {
    const res = await fetch(restUrl(`tasks?id=eq.${id}`), {
      method: "DELETE",
      headers: serviceHeaders(),
    });
    await res.body?.cancel();
  }
}

async function deleteProject(id: string): Promise<void> {
  const res = await fetch(restUrl(`projects?id=eq.${id}`), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  await res.body?.cancel();
}

interface CallLogRow {
  records_returned: number | null;
  returned_ids: string[] | null;
}

/** Most-recent function_call_logs row for the tool (this file is its only caller). */
async function latestLog(functionName: string): Promise<CallLogRow> {
  const url = `${REST}/function_call_logs?function_name=eq.${functionName}` +
    `&select=records_returned,returned_ids&order=called_at.desc&limit=1`;
  const res = await fetch(url, { headers: AUTH });
  const rows = await res.json() as CallLogRow[];
  assertExists(rows[0], `expected a ${functionName} log row`);
  return rows[0];
}

Deno.test("list_open_tasks_by_project groups incomplete tasks, excludes done/archived, buckets no-project", async () => {
  const projectName = uniqueName("GroupedView Project");
  const openContent = uniqueName("grouped-open");
  const inProgressContent = uniqueName("grouped-inprogress");
  const deferredContent = uniqueName("grouped-deferred");
  const doneContent = uniqueName("grouped-done");
  const archivedContent = uniqueName("grouped-archived");
  const orphanContent = uniqueName("grouped-orphan");

  const projectId = await createProject(projectName);
  const created: string[] = [];
  try {
    created.push(
      taskIdFrom(
        await callTool("create_task", {
          content: openContent,
          project_id: projectId,
        }),
      ),
    );
    created.push(
      taskIdFrom(
        await callTool("create_task", {
          content: inProgressContent,
          project_id: projectId,
          status: "in_progress",
        }),
      ),
    );
    created.push(
      taskIdFrom(
        await callTool("create_task", {
          content: deferredContent,
          project_id: projectId,
          status: "deferred",
        }),
      ),
    );

    // done → auto-archived, must be excluded.
    const doneId = taskIdFrom(
      await callTool("create_task", {
        content: doneContent,
        project_id: projectId,
      }),
    );
    created.push(doneId);
    await callTool("update_task", { id: doneId, status: "done" });

    // archived but not done, must be excluded.
    const archivedId = taskIdFrom(
      await callTool("create_task", {
        content: archivedContent,
        project_id: projectId,
      }),
    );
    created.push(archivedId);
    await callTool("archive_task", { id: archivedId });

    // no project → the "(No project)" bucket.
    created.push(
      taskIdFrom(await callTool("create_task", { content: orphanContent })),
    );

    const body = await callTool("list_open_tasks_by_project", {});

    // Incomplete tasks appear under their project heading.
    assertStringIncludes(body, `## ${projectName}`);
    assertStringIncludes(body, openContent);
    assertStringIncludes(body, inProgressContent);
    assertStringIncludes(body, deferredContent);

    // done + archived are excluded.
    assertEquals(
      body.includes(doneContent),
      false,
      "done/archived task must not appear",
    );
    assertEquals(
      body.includes(archivedContent),
      false,
      "archived task must not appear",
    );

    // Unassigned task lands in the no-project bucket.
    assertStringIncludes(body, "## (No project)");
    assertStringIncludes(body, orphanContent);

    // include_deferred=false drops deferred but keeps open/in_progress.
    const noDeferred = await callTool("list_open_tasks_by_project", {
      include_deferred: false,
    });
    assertEquals(
      noDeferred.includes(deferredContent),
      false,
      "deferred task must be hidden when include_deferred=false",
    );
    assertStringIncludes(noDeferred, openContent);

    // A tiny cap truncates (the brain now has more than one open task) and says so.
    const truncated = await callTool("list_open_tasks_by_project", {
      limit: 1,
    });
    assertStringIncludes(truncated, "more exist");
  } finally {
    await deleteTasks(created);
    await deleteProject(projectId);
  }
});

Deno.test("list_open_tasks_by_project logs real records_returned and returned_ids", async () => {
  const openContent = uniqueName("grouped-telemetry");
  const created: string[] = [];
  try {
    const id = taskIdFrom(
      await callTool("create_task", { content: openContent }),
    );
    created.push(id);

    const body = await callTool("list_open_tasks_by_project", { limit: 1000 });
    const match = body.match(/(\d+) open task\(s\) across/);
    assertExists(match, "header should report a total count");
    const total = Number(match![1]);

    const log = await latestLog("list_open_tasks_by_project");
    assertEquals(
      log.records_returned,
      total,
      "records_returned must equal the emitted task total",
    );
    assertExists(log.returned_ids);
    assertEquals(
      log.returned_ids?.length,
      total,
      "returned_ids length must equal the emitted total",
    );
    assertEquals(
      log.returned_ids?.includes(id),
      true,
      "returned_ids must include the seeded task id",
    );
  } finally {
    await deleteTasks(created);
  }
});
