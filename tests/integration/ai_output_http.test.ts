import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const MCP_BASE =
  "http://localhost:54321/functions/v1/terrestrial-brain-mcp?key=dev-test-key-123";

function httpUrl(endpoint: string): string {
  return `http://localhost:54321/functions/v1/terrestrial-brain-mcp/${endpoint}?key=dev-test-key-123`;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(MCP_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const text = await res.text();
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
    return parsed.result?.content?.[0]?.text || "";
  }
  const parsed = JSON.parse(text);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
  return parsed.result?.content?.[0]?.text || "";
}

async function callHTTP(
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(httpUrl(endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const responseBody = await response.json();
  return { status: response.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// /get-pending-ai-output-metadata HTTP endpoint tests
// ---------------------------------------------------------------------------

let httpTestOutputId: string;

Deno.test("HTTP: create test output for HTTP endpoint tests", async () => {
  const result = await callTool("create_ai_output", {
    title: "HTTP Endpoint Test",
    content: "Test content for HTTP endpoints",
    file_path: "test/http-endpoint-test.md",
    source_context: "HTTP integration test",
  });
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain output id");
  httpTestOutputId = match![1];
});

Deno.test("HTTP: /get-pending-ai-output-metadata returns metadata without content", async () => {
  const { status, body } = await callHTTP("get-pending-ai-output-metadata");
  assertEquals(status, 200);
  assertEquals(body.success, true);
  const data = body.data as { id: string; title: string; content?: string; content_size: number }[];
  assertEquals(Array.isArray(data), true);

  const found = data.find((item) => item.id === httpTestOutputId);
  assertExists(found, "Should find test output in metadata");
  assertEquals(found.title, "HTTP Endpoint Test");
  assertEquals(typeof found.content_size, "number");
  assertEquals(found.content, undefined, "content body should NOT be present");
});

// ---------------------------------------------------------------------------
// /get-pending-ai-output HTTP endpoint tests
// ---------------------------------------------------------------------------

Deno.test("HTTP: /get-pending-ai-output returns full content", async () => {
  const { status, body } = await callHTTP("get-pending-ai-output");
  assertEquals(status, 200);
  assertEquals(body.success, true);
  const data = body.data as { id: string; content: string }[];
  assertEquals(Array.isArray(data), true);

  const found = data.find((item) => item.id === httpTestOutputId);
  assertExists(found, "Should find test output in pending list");
  assertEquals(found.content, "Test content for HTTP endpoints");
});

// ---------------------------------------------------------------------------
// /fetch-ai-output-content HTTP endpoint tests
// ---------------------------------------------------------------------------

Deno.test("HTTP: /fetch-ai-output-content returns content for valid pending IDs", async () => {
  const { status, body } = await callHTTP("fetch-ai-output-content", { ids: [httpTestOutputId] });
  assertEquals(status, 200);
  assertEquals(body.success, true);
  const data = body.data as { id: string; content: string }[];
  assertEquals(data.length, 1);
  assertEquals(data[0].id, httpTestOutputId);
  assertEquals(data[0].content, "Test content for HTTP endpoints");
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
// /mark-ai-output-picked-up HTTP endpoint tests
// ---------------------------------------------------------------------------

Deno.test("HTTP: /mark-ai-output-picked-up marks output as picked up", async () => {
  const { status, body } = await callHTTP("mark-ai-output-picked-up", { ids: [httpTestOutputId] });
  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals((body.message as string).includes("1 output"), true);
});

Deno.test("HTTP: picked-up output no longer in pending", async () => {
  const { body } = await callHTTP("get-pending-ai-output-metadata");
  const data = body.data as { id: string }[];
  const found = data.find((item) => item.id === httpTestOutputId);
  assertEquals(found, undefined, "Picked-up output should not appear in pending");
});

Deno.test("HTTP: /mark-ai-output-picked-up returns 400 without ids", async () => {
  const { status, body } = await callHTTP("mark-ai-output-picked-up", {});
  assertEquals(status, 400);
  assertEquals(body.success, false);
  assertEquals(body.error, "ids array is required");
});

// ---------------------------------------------------------------------------
// /reject-ai-output HTTP endpoint tests
// ---------------------------------------------------------------------------

let rejectTestId: string;

Deno.test("HTTP: create output for reject test", async () => {
  const result = await callTool("create_ai_output", {
    title: "HTTP Reject Test",
    content: "Content to reject",
    file_path: "test/http-reject-test.md",
  });
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match);
  rejectTestId = match![1];
});

Deno.test("HTTP: /reject-ai-output rejects output", async () => {
  const { status, body } = await callHTTP("reject-ai-output", { ids: [rejectTestId] });
  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals((body.message as string).includes("1 output"), true);
});

Deno.test("HTTP: rejected output no longer in pending", async () => {
  const { body } = await callHTTP("get-pending-ai-output");
  const data = body.data as { id: string }[];
  const found = data.find((item) => item.id === rejectTestId);
  assertEquals(found, undefined, "Rejected output should not appear in pending");
});

Deno.test("HTTP: /reject-ai-output returns 400 without ids", async () => {
  const { status, body } = await callHTTP("reject-ai-output", {});
  assertEquals(status, 400);
  assertEquals(body.success, false);
  assertEquals(body.error, "ids array is required");
});

Deno.test("HTTP: /fetch-ai-output-content returns empty for rejected IDs", async () => {
  const { body } = await callHTTP("fetch-ai-output-content", { ids: [rejectTestId] });
  assertEquals((body.data as unknown[]).length, 0, "Rejected output should not be fetchable");
});

// ---------------------------------------------------------------------------
// Auth tests for HTTP endpoints
// ---------------------------------------------------------------------------

Deno.test("HTTP: endpoints return 401 without valid key", async () => {
  const noAuthUrl = "http://localhost:54321/functions/v1/terrestrial-brain-mcp/get-pending-ai-output-metadata";
  const response = await fetch(noAuthUrl, {
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
  const response = await fetch(MCP_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/list",
      params: {},
    }),
  });

  const text = await response.text();
  let result;
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find((line: string) => line.startsWith("data:"));
    assertExists(dataLine, "SSE response should contain data line");
    result = JSON.parse(dataLine.slice(5).trim());
  } else {
    result = JSON.parse(text);
  }

  const toolNames: string[] = (result.result?.tools || []).map((tool: { name: string }) => tool.name);

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
      toolNames.includes(tool),
      false,
      `${tool} should NOT be in MCP tool list — it is now an HTTP endpoint`,
    );
  }

  // These should still be present as MCP tools
  assertEquals(toolNames.includes("create_ai_output"), true, "create_ai_output should remain in MCP");
  assertEquals(toolNames.includes("create_tasks_with_output"), true, "create_tasks_with_output should remain in MCP");
});

// ---------------------------------------------------------------------------
// Empty state tests
// ---------------------------------------------------------------------------

Deno.test("HTTP: /get-pending-ai-output returns empty array when no pending outputs", async () => {
  // Clean up any remaining pending outputs first
  const { body: pendingBody } = await callHTTP("get-pending-ai-output");
  const pending = pendingBody.data as { id: string }[];
  if (pending.length > 0) {
    const ids = pending.map((item) => item.id);
    await callHTTP("mark-ai-output-picked-up", { ids });
  }

  const { status, body } = await callHTTP("get-pending-ai-output");
  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals((body.data as unknown[]).length, 0);
});

Deno.test("HTTP: /get-pending-ai-output-metadata returns empty array when no pending outputs", async () => {
  const { status, body } = await callHTTP("get-pending-ai-output-metadata");
  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals((body.data as unknown[]).length, 0);
});
