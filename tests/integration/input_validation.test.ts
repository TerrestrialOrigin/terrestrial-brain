import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  callTool,
  callToolRaw,
  restUrl,
  serviceHeaders,
  SUPABASE_SERVICE_KEY,
  uniqueName,
} from "../helpers/mcp-client.ts";

// Input-validation & tool-convention tests (Step 24 — findings 6.3, 7.2, 7.3,
// 5.3, 7.3-stats). Each test owns its fixtures and cleans up in `finally`.
//
// Zod schema failures surface as a tool result with `isError: true` whose text
// is "MCP error -32602: Input validation error: …", NOT a JSON-RPC error — so
// they are asserted via `callToolRaw`.

const SEED_PROJECT_ID = "00000000-0000-0000-0000-000000000002"; // Terrestrial Brain
// A well-formed (RFC 4122 v4) UUID that does not exist in any table.
const ABSENT_UUID = "11111111-1111-4111-8111-111111111111";

function idFrom(result: string): string {
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, `Should contain an id: ${result}`);
  return match![1];
}

async function deleteById(table: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    await fetch(restUrl(`${table}?id=eq.${id}`), {
      method: "DELETE",
      headers: serviceHeaders(),
    });
  }
}

// ─── Zod schema rejection (findings 6.3) ─────────────────────────────────────

Deno.test("invalid enum status is rejected at the tool boundary, no row changed", async () => {
  const created: string[] = [];
  try {
    const createResult = await callTool("create_task", {
      content: uniqueName("enum-validation task"),
      project_id: SEED_PROJECT_ID,
    });
    const taskId = idFrom(createResult);
    created.push(taskId);

    const { text, isError } = await callToolRaw("update_task", {
      id: taskId,
      status: "not_a_real_status",
    });
    assertEquals(isError, true);
    assertStringIncludes(text.toLowerCase(), "validation");

    // The task's status must be untouched (still the default "open").
    const rows = await (await fetch(restUrl(`tasks?id=eq.${taskId}`), {
      headers: serviceHeaders(),
    })).json();
    assertEquals(rows[0].status, "open");
  } finally {
    await deleteById("tasks", created);
  }
});

Deno.test("non-UUID id is rejected before any lookup", async () => {
  const { text, isError } = await callToolRaw("get_project", {
    id: "not-a-uuid",
  });
  assertEquals(isError, true);
  assertStringIncludes(text.toLowerCase(), "validation");
});

Deno.test("over-max limit is rejected", async () => {
  const { text, isError } = await callToolRaw("list_tasks", { limit: 101 });
  assertEquals(isError, true);
  assertStringIncludes(text.toLowerCase(), "validation");
});

Deno.test("get_tasks rejects more than 50 ids at the schema boundary", async () => {
  const tooMany = Array.from({ length: 51 }, () => ABSENT_UUID);
  const { text, isError } = await callToolRaw("get_tasks", { ids: tooMany });
  assertEquals(isError, true);
  assertStringIncludes(text.toLowerCase(), "validation");
});

// ─── Unified conventions (finding 7.2) ───────────────────────────────────────

Deno.test("get_project not-found is a non-error result", async () => {
  const { text, isError } = await callToolRaw("get_project", {
    id: ABSENT_UUID,
  });
  assertEquals(isError, false);
  assertStringIncludes(text, "No project found");
});

Deno.test("get_person not-found is a non-error result", async () => {
  const { text, isError } = await callToolRaw("get_person", {
    id: ABSENT_UUID,
  });
  assertEquals(isError, false);
  assertStringIncludes(text, "No person found");
});

Deno.test("update_task on a nonexistent UUID reports not-found and creates nothing", async () => {
  const { text, isError } = await callToolRaw("update_task", {
    id: ABSENT_UUID,
    content: uniqueName("should-not-persist"),
  });
  assertEquals(isError, true);
  assertStringIncludes(text.toLowerCase(), "not found");

  const rows = await (await fetch(restUrl(`tasks?id=eq.${ABSENT_UUID}`), {
    headers: serviceHeaders(),
  })).json();
  assertEquals(rows.length, 0, "no phantom row may be created");
});

Deno.test("update_project on a nonexistent UUID reports not-found", async () => {
  const { text, isError } = await callToolRaw("update_project", {
    id: ABSENT_UUID,
    name: uniqueName("nope"),
  });
  assertEquals(isError, true);
  assertStringIncludes(text.toLowerCase(), "not found");
});

Deno.test("update_task with no fields is an error", async () => {
  const created: string[] = [];
  try {
    const createResult = await callTool("create_task", {
      content: uniqueName("no-fields task"),
      project_id: SEED_PROJECT_ID,
    });
    const taskId = idFrom(createResult);
    created.push(taskId);

    const { text, isError } = await callToolRaw("update_task", { id: taskId });
    assertEquals(isError, true);
    assertStringIncludes(text, "must be provided");
  } finally {
    await deleteById("tasks", created);
  }
});

// ─── ilike wildcard escaping (finding 5.3) ───────────────────────────────────

Deno.test("a '%' search matches literally, not every document", async () => {
  const created: string[] = [];
  try {
    const withPercent = await callTool("write_document", {
      title: uniqueName("Deal 50% off"),
      content: "discount doc",
      project_id: SEED_PROJECT_ID,
    });
    const plain = await callTool("write_document", {
      title: uniqueName("Plain doc"),
      content: "ordinary doc",
      project_id: SEED_PROJECT_ID,
    });
    const withPercentId = idFrom(withPercent);
    const plainId = idFrom(plain);
    created.push(withPercentId, plainId);

    const results = await callTool("list_documents", { title_contains: "%" });
    // The escaped '%' must match only titles that literally contain '%'.
    assertStringIncludes(results, withPercentId);
    assertEquals(
      results.includes(plainId),
      false,
      "a literal '%' search must NOT return a title with no '%'",
    );
  } finally {
    await deleteById("documents", created);
  }
});

// ─── thought_stats via SQL RPC (finding 7.3) ─────────────────────────────────

Deno.test("thought_stats aggregates via the RPC and matches a direct count", async () => {
  // Seed thoughts scoped to a fresh, unique project id so the count is exact.
  const projectId = crypto.randomUUID();
  const seededIds: string[] = [];
  try {
    for (let index = 0; index < 3; index++) {
      const row = await (await fetch(restUrl("thoughts"), {
        method: "POST",
        headers: serviceHeaders({
          "Content-Type": "application/json",
          Prefer: "return=representation",
        }),
        body: JSON.stringify({
          content: uniqueName(`stats thought ${index}`),
          metadata: {
            type: "observation",
            references: { projects: [projectId] },
          },
        }),
      })).json();
      seededIds.push(row[0].id);
    }

    const result = await callTool("thought_stats", { project_id: projectId });
    assertStringIncludes(result, "Total thoughts: 3");
    assertStringIncludes(result, "observation: 3");
  } finally {
    await deleteById("thoughts", seededIds);
  }
});

Deno.test("thought_stats RPC is not executable with the anon key", async () => {
  const anonKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
  const anonResponse = await fetch(restUrl("rpc/thought_stats"), {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  await anonResponse.body?.cancel();
  assertEquals(
    anonResponse.status === 401 || anonResponse.status === 403 ||
      anonResponse.status === 404,
    true,
    `anon thought_stats RPC must be rejected, got ${anonResponse.status}`,
  );

  const serviceResponse = await fetch(restUrl("rpc/thought_stats"), {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assertEquals(serviceResponse.ok, true, "service role may execute the RPC");
  await serviceResponse.body?.cancel();
});
