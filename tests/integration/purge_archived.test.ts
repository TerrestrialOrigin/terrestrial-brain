// Integration tests for the archive retention/erasure pathway (SQL-9). Drives
// the real `purge_archived` MCP tool end-to-end (tool -> repo -> RPC -> DB) with
// no mocks on the path, and asserts DB state via the service-role client.
// Self-owned fixtures: each test creates uniquely-marked rows and deletes them
// in `finally`.

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  callTool,
  restUrl,
  serviceHeaders,
  uniqueName,
} from "../helpers/mcp-client.ts";

async function seed(
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(restUrl(table), {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    }),
    body: JSON.stringify(row),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`seed ${table}: ${JSON.stringify(body)}`);
  return body[0].id as string;
}

async function existsById(table: string, id: string): Promise<boolean> {
  const response = await fetch(restUrl(`${table}?id=eq.${id}&select=id`), {
    headers: serviceHeaders(),
  });
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function hardDelete(table: string, id: string): Promise<void> {
  const response = await fetch(restUrl(`${table}?id=eq.${id}`), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  await response.body?.cancel();
}

Deno.test("purge_archived: dry-run (no confirm) reports counts and deletes nothing", async () => {
  const name = uniqueName("dryrun-person");
  const personId = await seed("people", { name, archived_at: "2024-01-01" });
  try {
    const result = await callTool("purge_archived", { table: "people" });
    assertStringIncludes(result, "DRY RUN");
    // The archived person must still exist — a dry-run deletes nothing.
    assertEquals(
      await existsById("people", personId),
      true,
      "dry-run must not delete",
    );
  } finally {
    await hardDelete("people", personId);
  }
});

Deno.test("purge_archived: targeted confirm deletes only matching archived rows", async () => {
  const oldName = uniqueName("old-archived");
  const recentName = uniqueName("recent-archived");
  const liveName = uniqueName("live-person");
  const oldId = await seed("people", {
    name: oldName,
    archived_at: "2024-01-01",
  });
  const recentId = await seed("people", {
    name: recentName,
    archived_at: new Date().toISOString(),
  });
  const liveId = await seed("people", { name: liveName });
  try {
    const result = await callTool("purge_archived", {
      table: "people",
      on_or_before: "2024-06-01",
      confirm: true,
    });
    assertStringIncludes(result, "Purged");

    assertEquals(
      await existsById("people", oldId),
      false,
      "old archived → gone",
    );
    assertEquals(
      await existsById("people", recentId),
      true,
      "recently-archived (after the cutoff) → kept",
    );
    assertEquals(
      await existsById("people", liveId),
      true,
      "non-archived → kept",
    );
  } finally {
    await hardDelete("people", oldId);
    await hardDelete("people", recentId);
    await hardDelete("people", liveId);
  }
});

Deno.test("purge_archived: purging an archived project cascade-deletes its documents and reports it", async () => {
  const projectName = uniqueName("archived-proj");
  const projectId = await seed("projects", {
    name: projectName,
    archived_at: "2024-01-01",
  });
  const docId = await seed("documents", {
    title: uniqueName("proj-doc"),
    content: "body",
    project_id: projectId,
  });
  try {
    const result = await callTool("purge_archived", {
      table: "projects",
      on_or_before: "2024-06-01",
      confirm: true,
    });
    assertStringIncludes(result, "documents (via project cascade)");

    assertEquals(
      await existsById("projects", projectId),
      false,
      "project gone",
    );
    assertEquals(
      await existsById("documents", docId),
      false,
      "its document cascade-deleted",
    );
  } finally {
    // Best-effort in case the purge did not run (rows may already be gone).
    await hardDelete("documents", docId);
    await hardDelete("projects", projectId);
  }
});
