import { assertEquals, assertExists } from "@std/assert";
import {
  callTool,
  callToolRaw,
  restUrl,
  serviceHeaders,
  uniqueName,
} from "../helpers/mcp-client.ts";

// ─── Project Tests ───────────────────────────────────────────────────────────
//
// Each test owns its own uniquely-named fixtures and deletes them in `finally`
// so tests are order-independent, run standalone via --filter, and never leave
// rows accumulating across runs.

function projectIdFrom(result: string): string {
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain project id");
  return match![1];
}

async function deleteProjects(ids: string[]): Promise<void> {
  // Delete children before parents to respect any FK ordering.
  for (const id of [...ids].reverse()) {
    await fetch(restUrl(`projects?id=eq.${id}`), {
      method: "DELETE",
      headers: serviceHeaders(),
    });
  }
}

Deno.test("create_project creates a project and list_projects shows it", async () => {
  const name = uniqueName("Integration Test Project");
  const created: string[] = [];
  try {
    const result = await callTool("create_project", {
      name,
      type: "personal",
      description: "Created by integration tests",
    });
    assertExists(result);
    created.push(projectIdFrom(result));

    const list = await callTool("list_projects", {});
    assertExists(list);
    assertEquals(list.includes(name), true);
  } finally {
    await deleteProjects(created);
  }
});

Deno.test("create_project with parent_id works and get_project shows children", async () => {
  const parentName = uniqueName("Parent Test Project");
  const childName = uniqueName("Child Test Project");
  const created: string[] = [];
  try {
    const parentResult = await callTool("create_project", {
      name: parentName,
      type: "personal",
    });
    const parentId = projectIdFrom(parentResult);
    created.push(parentId);

    const childResult = await callTool("create_project", {
      name: childName,
      type: "personal",
      parent_id: parentId,
    });
    assertExists(childResult);
    assertEquals(childResult.includes(childName), true);
    created.push(projectIdFrom(childResult));

    const parent = await callTool("get_project", { id: parentId });
    assertExists(parent);
    assertEquals(parent.includes(childName), true);
    assertEquals(parent.includes(parentName), true);
  } finally {
    await deleteProjects(created);
  }
});

Deno.test("update_project rejects a parent_id that would create a cycle (TOOL-2)", async () => {
  const parentName = uniqueName("Cycle Parent");
  const childName = uniqueName("Cycle Child");
  const created: string[] = [];
  try {
    const parentResult = await callTool("create_project", {
      name: parentName,
      type: "personal",
    });
    const parentId = projectIdFrom(parentResult);
    created.push(parentId);

    const childResult = await callTool("create_project", {
      name: childName,
      type: "personal",
      parent_id: parentId,
    });
    const childId = projectIdFrom(childResult);
    created.push(childId);

    // Making the parent's parent its own child (parent -> child -> parent).
    const result = await callToolRaw("update_project", {
      id: parentId,
      parent_id: childId,
    });
    assertEquals(
      result.isError,
      true,
      `expected an error result: ${result.text}`,
    );
    assertEquals(
      result.text.toLowerCase().includes("cycle"),
      true,
      `expected a cycle rejection, got: ${result.text}`,
    );

    // The parent's parent_id must remain unchanged (null), not the cyclic value.
    const rows = await (await fetch(
      restUrl(`projects?id=eq.${parentId}&select=parent_id`),
      { headers: serviceHeaders() },
    )).json() as { parent_id: string | null }[];
    assertEquals(rows[0].parent_id, null);
  } finally {
    await deleteProjects(created);
  }
});

Deno.test("update_project changes description", async () => {
  const name = uniqueName("Update Test Project");
  const created: string[] = [];
  try {
    const createResult = await callTool("create_project", {
      name,
      type: "personal",
    });
    const projectId = projectIdFrom(createResult);
    created.push(projectId);

    const result = await callTool("update_project", {
      id: projectId,
      description: "Updated by integration test",
    });
    assertExists(result);
    assertEquals(result.includes("description"), true);
  } finally {
    await deleteProjects(created);
  }
});

Deno.test("archive_project archives project and children; archived hidden from list by default", async () => {
  const parentName = uniqueName("Archive Test Project");
  const childName = uniqueName("Archive Child Project");
  const created: string[] = [];
  try {
    const parentResult = await callTool("create_project", {
      name: parentName,
      type: "personal",
    });
    const parentId = projectIdFrom(parentResult);
    created.push(parentId);

    const childResult = await callTool("create_project", {
      name: childName,
      type: "personal",
      parent_id: parentId,
    });
    created.push(projectIdFrom(childResult));

    const archived = await callTool("archive_project", { id: parentId });
    assertExists(archived);
    assertEquals(archived.includes("Archived"), true);

    const list = await callTool("list_projects", {});
    assertEquals(
      list.includes(parentName),
      false,
      "Archived project should be hidden from list_projects by default",
    );
  } finally {
    await deleteProjects(created);
  }
});
