// memory-lifecycle-rules → "Task reconciliation is consent-based".
//
// Behavioral coverage (TEST-2): the reconciliation sweep surfaces open tasks
// with a confirm-to-close prompt and NEVER changes a task's status itself. The
// highest-risk consent invariant — that the sweep alone cannot auto-close a task
// — is asserted against durable task state, not just tool registration.

import { assert, assertEquals } from "@std/assert";
import {
  callTool,
  restUrl,
  serviceHeaders,
  uniqueName,
} from "../../helpers/mcp-client.ts";

function taskIdFrom(result: string): string {
  const match = result.match(/id: ([0-9a-f-]+)/);
  assert(match, `expected a task id in: ${result}`);
  return match![1];
}

async function taskRow(
  id: string,
): Promise<{ status: string; archived_at: string | null } | null> {
  const rows = await (await fetch(
    restUrl(`tasks?id=eq.${id}&select=status,archived_at`),
    { headers: serviceHeaders() },
  )).json() as { status: string; archived_at: string | null }[];
  return rows[0] ?? null;
}

async function deleteTask(id: string): Promise<void> {
  const response = await fetch(restUrl(`tasks?id=eq.${id}`), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  await response.body?.cancel();
}

// The sweep surfaces a confirm-to-close prompt and changes nothing without consent.
Deno.test(
  "reconciliation: the sweep asks before closing",
  async () => {
    const content = uniqueName("Reconcile ask-first task");
    const created = await callTool("create_task", { content });
    const id = taskIdFrom(created);
    try {
      const sweep = await callTool("reconcile_tasks", {});
      // The proposal must include this open task AND a confirm-to-close prompt.
      assert(sweep.includes(id), "the sweep must surface the open task id");
      assert(
        /confirm/i.test(sweep) && /clos/i.test(sweep),
        `the sweep must prompt for confirmation before closing: ${sweep}`,
      );
      // The sweep ALONE must not have changed the task's status.
      const after = await taskRow(id);
      assertEquals(
        after?.status,
        "open",
        "the sweep must not auto-close a task",
      );
    } finally {
      await deleteTask(id);
    }
  },
);

// Declining the proposed close leaves the task open with no status write.
Deno.test(
  "reconciliation: declining leaves the task open",
  async () => {
    const content = uniqueName("Reconcile decline task");
    const created = await callTool("create_task", { content });
    const id = taskIdFrom(created);
    try {
      // Run the sweep and take NO close action (the decline path).
      await callTool("reconcile_tasks", {});
      const after = await taskRow(id);
      assertEquals(after?.status, "open", "declining must leave the task open");
      assertEquals(
        after?.archived_at,
        null,
        "declining must not archive the task",
      );
    } finally {
      await deleteTask(id);
    }
  },
);
