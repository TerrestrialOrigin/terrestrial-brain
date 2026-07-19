// Integration coverage for the AI-output pull API (HTTP sub-routes). Every
// test owns its fixtures (TEST-9): unique titles/paths, ids registered before
// assertions, hard-delete cleanup in try/finally. No test mutates rows it did
// not create (TEST-11) — emptiness/absence is always asserted per fixture id.

import { assertEquals, assertExists } from "@std/assert";
import {
  callHTTPWithStatus as callHTTP,
  callTool,
  httpUrl,
  mcpHeaders,
  restUrl,
  serviceHeaders,
  toolNames,
  uniqueToken,
} from "../helpers/mcp-client.ts";

/** Extracts the `id: <uuid>` from a tool confirmation. */
function extractId(result: string): string {
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, `Response should contain an id. Got: ${result}`);
  return match![1];
}

/** Per-test ai_output fixture tracker with hard-delete cleanup. */
function makeOutputFixtures() {
  const outputIds: string[] = [];
  return {
    outputIds,
    async create(titlePrefix: string, content: string): Promise<string> {
      const token = uniqueToken();
      const result = await callTool("create_ai_output", {
        title: `${titlePrefix} ${token}`,
        content,
        file_path: `test/${
          titlePrefix.toLowerCase().replaceAll(" ", "-")
        }-${token}.md`,
        source_context: "HTTP integration test",
      });
      const outputId = extractId(result);
      outputIds.push(outputId);
      return outputId;
    },
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

// ---------------------------------------------------------------------------
// /get-pending-ai-output-metadata
// ---------------------------------------------------------------------------

Deno.test("HTTP: /get-pending-ai-output-metadata returns metadata without content", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const outputId = await fixtures.create(
      "HTTP Endpoint Test",
      "Test content for HTTP endpoints",
    );

    const { status, body } = await callHTTP("get-pending-ai-output-metadata");
    assertEquals(status, 200);
    assertEquals(body.success, true);
    const data = body.data as {
      id: string;
      title: string;
      content?: string;
      content_size: number;
    }[];
    assertEquals(Array.isArray(data), true);

    const found = data.find((item) => item.id === outputId);
    assertExists(found, "Should find test output in metadata");
    assertEquals(typeof found.content_size, "number");
    assertEquals(
      found.content,
      undefined,
      "content body should NOT be present",
    );
  } finally {
    await fixtures.cleanup();
  }
});

// ---------------------------------------------------------------------------
// /get-pending-ai-output
// ---------------------------------------------------------------------------

Deno.test("HTTP: /get-pending-ai-output returns full content", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const outputId = await fixtures.create(
      "HTTP Pending Test",
      "Test content for HTTP endpoints",
    );

    const { status, body } = await callHTTP("get-pending-ai-output");
    assertEquals(status, 200);
    assertEquals(body.success, true);
    const data = body.data as { id: string; content: string }[];
    assertEquals(Array.isArray(data), true);

    const found = data.find((item) => item.id === outputId);
    assertExists(found, "Should find test output in pending list");
    assertEquals(found.content, "Test content for HTTP endpoints");
  } finally {
    await fixtures.cleanup();
  }
});

// ---------------------------------------------------------------------------
// /fetch-ai-output-content
// ---------------------------------------------------------------------------

Deno.test("HTTP: /fetch-ai-output-content returns content for valid pending IDs", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const outputId = await fixtures.create(
      "HTTP Fetch Test",
      "Fetchable content",
    );

    const { status, body } = await callHTTP("fetch-ai-output-content", {
      ids: [outputId],
    });
    assertEquals(status, 200);
    assertEquals(body.success, true);
    const data = body.data as { id: string; content: string }[];
    assertEquals(data.length, 1);
    assertEquals(data[0].id, outputId);
    assertEquals(data[0].content, "Fetchable content");
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("HTTP: /fetch-ai-output-content returns 400 without ids", async () => {
  const { status, body } = await callHTTP("fetch-ai-output-content", {});
  assertEquals(status, 400);
  assertEquals(body.success, false);
  assertEquals(body.error, "ids array is required");
});

Deno.test("HTTP: /fetch-ai-output-content returns empty for non-existent IDs", async () => {
  const { status, body } = await callHTTP("fetch-ai-output-content", {
    ids: ["00000000-0000-0000-0000-000000000000"],
  });
  assertEquals(status, 200);
  assertEquals((body.data as unknown[]).length, 0);
});

// ---------------------------------------------------------------------------
// /mark-ai-output-picked-up
// ---------------------------------------------------------------------------

Deno.test("HTTP: /mark-ai-output-picked-up marks output as picked up and removes it from pending", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const outputId = await fixtures.create(
      "HTTP Pickup Test",
      "Content to pick up",
    );

    const { status, body } = await callHTTP("mark-ai-output-picked-up", {
      ids: [outputId],
    });
    assertEquals(status, 200);
    assertEquals(body.success, true);
    assertEquals((body.message as string).includes("1 output"), true);

    // The durable consequence: this specific id no longer appears in pending.
    const { body: pendingBody } = await callHTTP(
      "get-pending-ai-output-metadata",
    );
    const pending = pendingBody.data as { id: string }[];
    assertEquals(
      pending.find((item) => item.id === outputId),
      undefined,
      "Picked-up output should not appear in pending",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("HTTP: /mark-ai-output-picked-up returns 400 without ids", async () => {
  const { status, body } = await callHTTP("mark-ai-output-picked-up", {});
  assertEquals(status, 400);
  assertEquals(body.success, false);
  assertEquals(body.error, "ids array is required");
});

Deno.test("HTTP: retried pickup reports 0 outputs updated, not the request size", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const outputId = await fixtures.create(
      "HTTP Retry Pickup Test",
      "Content picked up twice",
    );
    await callHTTP("mark-ai-output-picked-up", { ids: [outputId] });

    // The claim-style filter updates nothing on a retry, and the message must
    // count what actually changed — never the request's array length.
    const { status, body } = await callHTTP("mark-ai-output-picked-up", {
      ids: [outputId],
    });
    assertEquals(status, 200);
    assertEquals(body.success, true);
    assertEquals(body.message, "Marked 0 outputs as picked up.");
  } finally {
    await fixtures.cleanup();
  }
});

// ---------------------------------------------------------------------------
// /reject-ai-output
// ---------------------------------------------------------------------------

Deno.test("HTTP: /reject-ai-output rejects output; rejected output is neither pending nor fetchable", async () => {
  const fixtures = makeOutputFixtures();
  try {
    const outputId = await fixtures.create(
      "HTTP Reject Test",
      "Content to reject",
    );

    const { status, body } = await callHTTP("reject-ai-output", {
      ids: [outputId],
    });
    assertEquals(status, 200);
    assertEquals(body.success, true);
    assertEquals((body.message as string).includes("1 output"), true);

    const { body: pendingBody } = await callHTTP("get-pending-ai-output");
    const pending = pendingBody.data as { id: string }[];
    assertEquals(
      pending.find((item) => item.id === outputId),
      undefined,
      "Rejected output should not appear in pending",
    );

    const { body: fetchBody } = await callHTTP("fetch-ai-output-content", {
      ids: [outputId],
    });
    assertEquals(
      (fetchBody.data as unknown[]).length,
      0,
      "Rejected output should not be fetchable",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("HTTP: /reject-ai-output returns 400 without ids", async () => {
  const { status, body } = await callHTTP("reject-ai-output", {});
  assertEquals(status, 400);
  assertEquals(body.success, false);
  assertEquals(body.error, "ids array is required");
});

// ---------------------------------------------------------------------------
// Request-envelope validation (Step 18 — CORE-5/CORE-6)
// ---------------------------------------------------------------------------

Deno.test("HTTP: a non-UUID ids element returns 400", async () => {
  const { status, body } = await callHTTP("fetch-ai-output-content", {
    ids: ["not-a-uuid"],
  });
  assertEquals(status, 400);
  assertEquals(body.success, false);
});

Deno.test("HTTP: malformed JSON returns 400, not 500", async () => {
  const response = await fetch(httpUrl("ingest-note"), {
    method: "POST",
    headers: mcpHeaders({ "Content-Type": "application/json" }),
    body: "{not json",
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, "Invalid JSON body");
});

// ---------------------------------------------------------------------------
// Auth tests for HTTP endpoints
// ---------------------------------------------------------------------------

Deno.test("HTTP: endpoints return 401 without valid key", async () => {
  const response = await fetch(httpUrl("get-pending-ai-output-metadata"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, "Invalid or missing access key");
});

// ---------------------------------------------------------------------------
// MCP tool list verification — migrated tools should be GONE
// ---------------------------------------------------------------------------

Deno.test("HTTP: migrated tools are NOT in MCP tool list", async () => {
  const registeredTools = await toolNames();

  // These should be REMOVED from MCP
  const removedTools = [
    "get_pending_ai_output",
    "get_pending_ai_output_metadata",
    "fetch_ai_output_content",
    "mark_ai_output_picked_up",
    "reject_ai_output",
  ];
  for (const tool of removedTools) {
    assertEquals(
      registeredTools.includes(tool),
      false,
      `${tool} should NOT be in MCP tool list — it is now an HTTP endpoint`,
    );
  }

  // These should still be present as MCP tools
  assertEquals(
    registeredTools.includes("create_ai_output"),
    true,
    "create_ai_output should remain in MCP",
  );
  assertEquals(
    registeredTools.includes("create_tasks_with_output"),
    true,
    "create_tasks_with_output should remain in MCP",
  );
});

// ---------------------------------------------------------------------------
// Response-shape tests (TEST-11: no test forces a GLOBAL empty state — the
// pending endpoints' shape is asserted without mutating rows the test does
// not own; per-id absence is covered by the pickup/reject tests above)
// ---------------------------------------------------------------------------

Deno.test("HTTP: /get-pending-ai-output returns an array payload", async () => {
  const { status, body } = await callHTTP("get-pending-ai-output");
  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals(Array.isArray(body.data), true);
});

Deno.test("HTTP: /get-pending-ai-output-metadata returns an array payload", async () => {
  const { status, body } = await callHTTP("get-pending-ai-output-metadata");
  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals(Array.isArray(body.data), true);
});
