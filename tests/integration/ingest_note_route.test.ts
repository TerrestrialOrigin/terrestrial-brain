import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase client + endpoints
// ---------------------------------------------------------------------------

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const MCP_BASE =
  "http://localhost:54321/functions/v1/terrestrial-brain-mcp?key=dev-test-key-123";
const INGEST_URL =
  "http://localhost:54321/functions/v1/terrestrial-brain-mcp/ingest-note?key=dev-test-key-123";

// ---------------------------------------------------------------------------
// /ingest-note HTTP route tests
// ---------------------------------------------------------------------------

const TEST_NOTE_ID = `test-ingest-route-${Date.now()}`;

Deno.test("/ingest-note does NOT fall through to MCP transport", async () => {
  // This test verifies that the /ingest-note path is handled by the direct
  // HTTP handler, not the MCP transport. The MCP transport would return 406
  // because callIngestNote doesn't send Accept: text/event-stream.
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Route test — should not hit MCP transport." }),
  });
  // If the MCP transport handled this, we'd get 406 with a JSON-RPC error.
  // The direct handler returns 200 with { success: true }.
  assertEquals(response.status, 200, "Should be handled by direct route, not MCP (which would return 406)");
  const body = await response.json();
  assertEquals(body.success, true);
  assertExists(body.message);
});

Deno.test("/ingest-note returns 401 without valid key", async () => {
  const response = await fetch(
    "http://localhost:54321/functions/v1/terrestrial-brain-mcp/ingest-note",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "test" }),
    },
  );
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, "Invalid or missing access key");
});

Deno.test("/ingest-note returns 400 when content is missing", async () => {
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "No content" }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
  assertEquals(body.error, "content is required");
});

Deno.test("/ingest-note returns 400 when content is empty string", async () => {
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "   " }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
  assertEquals(body.error, "content is required");
});

Deno.test("/ingest-note ingests a note and sets reliability and author", async () => {
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "The ingest route test verifies that thoughts have correct provenance fields after ingestion.",
      title: "Ingest Route Test",
      note_id: TEST_NOTE_ID,
    }),
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertExists(body.message);

  // Verify thoughts were created with correct reliability and author
  const { data: thoughts, error } = await supabase
    .from("thoughts")
    .select("content, reliability, author, metadata")
    .eq("reference_id", TEST_NOTE_ID);

  assertEquals(error, null);
  assertExists(thoughts);
  assertEquals(thoughts.length > 0, true, "Should have ingested at least one thought");

  for (const thought of thoughts) {
    assertEquals(thought.reliability, "less reliable", "reliability should be 'less reliable'");
    assertEquals(thought.author, "gpt-4o-mini", "author should be 'gpt-4o-mini'");
  }
});

// ---------------------------------------------------------------------------
// MCP tool list verification
// ---------------------------------------------------------------------------

Deno.test("ingest_note is NOT in MCP tool list", async () => {
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

  const toolNames = (result.result?.tools || []).map((tool: { name: string }) => tool.name);
  assertEquals(
    toolNames.includes("ingest_note"),
    false,
    `ingest_note should NOT be in tool list. Found tools: ${toolNames.join(", ")}`,
  );

  // Verify other expected tools ARE still present
  assertEquals(toolNames.includes("capture_thought"), true, "capture_thought should still be in tool list");
  assertEquals(toolNames.includes("search_thoughts"), true, "search_thoughts should still be in tool list");
  assertEquals(toolNames.includes("list_thoughts"), true, "list_thoughts should still be in tool list");
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

Deno.test("cleanup ingest route test data", async () => {
  const { error } = await supabase
    .from("thoughts")
    .delete()
    .eq("reference_id", TEST_NOTE_ID);
  assertEquals(error, null, "Cleanup should succeed");

  // Also clean up note_snapshots
  const { error: snapshotError } = await supabase
    .from("note_snapshots")
    .delete()
    .eq("reference_id", TEST_NOTE_ID);
  assertEquals(snapshotError, null, "Snapshot cleanup should succeed");
});
