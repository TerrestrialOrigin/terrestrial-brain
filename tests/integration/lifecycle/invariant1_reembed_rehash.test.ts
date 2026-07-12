// memory-lifecycle-rules → "Every content edit re-embeds and re-hashes (INVARIANT 1)".
//
// Step 7 implements this: `update_thought` re-embeds (shipped) AND re-hashes, and
// the content_hash guarantee extends to projects/tasks/documents. These tests
// assert the REAL stored hash equals the hash of the new content (not just that
// the column exists), through the one server-side update path.

import { assert, assertEquals } from "@std/assert";
import {
  callTool,
  restUrl,
  serviceHeaders,
  uniqueName,
} from "../../helpers/mcp-client.ts";
import {
  captureThought,
  deleteThoughtsByMarker,
  lifecycleMarker,
} from "./_thoughts.ts";

/** SHA-256 hex — must match the server's `hashContent` (helpers.ts). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function firstRow(
  table: string,
  filter: string,
  columns: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    restUrl(`${table}?${filter}&select=${columns}`),
    { headers: serviceHeaders() },
  );
  const rows = (await response.json()) as Record<string, unknown>[];
  return rows[0] ?? null;
}

async function del(table: string, filter: string): Promise<void> {
  const response = await fetch(restUrl(`${table}?${filter}`), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  await response.body?.cancel();
}

// Pass-now: editing a thought re-embeds, so it is found by its NEW wording.
Deno.test("invariant1: edited thought is found by its new wording", async () => {
  const marker = lifecycleMarker("inv1-search");
  try {
    const thought = await captureThought(
      marker,
      `${marker} originaltokenxenon photosynthesis`,
    );
    await callTool("update_thought", {
      id: thought.id,
      content: `${marker} replacementtokenquokka meteorology`,
    });
    const results = await callTool("search_thoughts", {
      query: "replacementtokenquokka meteorology",
      limit: 10,
      threshold: 0.1,
    });
    assert(
      results.includes(marker),
      `expected the re-embedded thought (${marker}) to match its new wording`,
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// A thought content edit stamps content_hash = sha256(new content).
Deno.test("invariant1: a thought content edit stores the hash of the new content", async () => {
  const marker = lifecycleMarker("inv1-hash");
  try {
    const thought = await captureThought(marker, `${marker} first wording`);
    const newContent = `${marker} entirely rewritten wording`;
    await callTool("update_thought", { id: thought.id, content: newContent });
    const row = await firstRow(
      "thoughts",
      `id=eq.${thought.id}`,
      "content_hash",
    );
    assertEquals(
      row?.content_hash,
      await sha256Hex(newContent),
      "stored thought content_hash must equal sha256 of the new content",
    );
  } finally {
    await deleteThoughtsByMarker(marker);
  }
});

// The guarantee holds for projects, tasks, and documents, not only thoughts.
Deno.test("invariant1: content_hash re-hashes on project, task, and document edits", async () => {
  const projectName = uniqueName("inv1proj");
  const taskMarker = lifecycleMarker("inv1-task");
  let projectId = "";
  try {
    // Project: create, edit its description, assert the hash.
    await callTool("create_project", {
      name: projectName,
      description: "initial",
    });
    const projectRow = await firstRow(
      "projects",
      `name=eq.${encodeURIComponent(projectName)}`,
      "id",
    );
    projectId = String(projectRow?.id);
    const newDescription = `${projectName} revised description prose`;
    await callTool("update_project", {
      id: projectId,
      description: newDescription,
    });
    const projectAfter = await firstRow(
      "projects",
      `id=eq.${projectId}`,
      "content_hash",
    );
    assertEquals(
      projectAfter?.content_hash,
      await sha256Hex(newDescription),
      "project content_hash must equal sha256 of the new description",
    );

    // Task: create under the project, edit its content, assert the hash.
    await callTool("create_task", {
      content: `${taskMarker} initial task`,
      project_id: projectId,
    });
    const taskRow = await firstRow(
      "tasks",
      `content=ilike.*${encodeURIComponent(taskMarker)}*`,
      "id",
    );
    const taskId = String(taskRow?.id);
    const newTaskContent = `${taskMarker} rewritten task content`;
    await callTool("update_task", { id: taskId, content: newTaskContent });
    const taskAfter = await firstRow(
      "tasks",
      `id=eq.${taskId}`,
      "content_hash",
    );
    assertEquals(
      taskAfter?.content_hash,
      await sha256Hex(newTaskContent),
      "task content_hash must equal sha256 of the new content",
    );

    // Document: create under the project, edit its content, assert the hash.
    await callTool("write_document", {
      title: `${projectName} doc`,
      content: "initial document body",
      project_id: projectId,
    });
    const docRow = await firstRow(
      "documents",
      `title=eq.${encodeURIComponent(projectName + " doc")}`,
      "id",
    );
    const docId = String(docRow?.id);
    const newDocContent = `${projectName} rewritten document body`;
    await callTool("update_document", { id: docId, content: newDocContent });
    const docAfter = await firstRow(
      "documents",
      `id=eq.${docId}`,
      "content_hash",
    );
    assertEquals(
      docAfter?.content_hash,
      await sha256Hex(newDocContent),
      "document content_hash must equal sha256 of the new content",
    );
  } finally {
    if (projectId) {
      await del("documents", `project_id=eq.${projectId}`);
      await del("tasks", `project_id=eq.${projectId}`);
      await del("projects", `id=eq.${projectId}`);
    }
  }
});

// Emptying content is a valid edit, still re-hashed (never swallowed).
Deno.test("invariant1: emptying a thought's content is a valid, re-hashed edit", async () => {
  const marker = lifecycleMarker("inv1-empty");
  let thoughtId = "";
  try {
    const thought = await captureThought(marker, `${marker} some content`);
    thoughtId = thought.id;
    await callTool("update_thought", { id: thought.id, content: "" });
    const row = await firstRow(
      "thoughts",
      `id=eq.${thought.id}`,
      "id,content_hash",
    );
    assert(row !== null, "thought must still exist after emptying its content");
    assertEquals(
      row?.content_hash,
      await sha256Hex(""),
      "emptied content must be re-hashed as sha256 of the empty string",
    );
  } finally {
    // Content is now empty, so delete by id (marker no longer in content).
    if (thoughtId) await del("thoughts", `id=eq.${thoughtId}`);
  }
});
