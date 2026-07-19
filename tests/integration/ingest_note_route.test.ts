import { assertEquals, assertExists } from "@std/assert";
import {
  httpUrl,
  mcpHeaders,
  restUrl,
  serviceHeaders,
  toolNames,
  uniqueToken,
} from "../helpers/mcp-client.ts";

// ---------------------------------------------------------------------------
// /ingest-note HTTP route tests
//
// Connection constants and SSE parsing come from tests/helpers/mcp-client.ts
// (TEST-12). Each ingesting test passes its own unique note_id and hard-deletes
// the thoughts AND note_snapshots it caused in `finally` (TEST-16).
// ---------------------------------------------------------------------------

const INGEST_URL = httpUrl("ingest-note");

/** Hard-deletes the thoughts and note snapshot rows for a test's note id. */
async function deleteIngestArtifacts(noteId: string): Promise<void> {
  for (const table of ["thoughts", "note_snapshots"]) {
    const response = await fetch(
      restUrl(`${table}?reference_id=eq.${encodeURIComponent(noteId)}`),
      { method: "DELETE", headers: serviceHeaders() },
    );
    await response.body?.cancel();
  }
}

Deno.test("/ingest-note does NOT fall through to MCP transport", async () => {
  // This test verifies that the /ingest-note path is handled by the direct
  // HTTP handler, not the MCP transport. The MCP transport would return 406
  // because this request doesn't send Accept: text/event-stream.
  //
  // TEST-16: a unique note_id is passed so the thoughts this ingest creates
  // are addressable (previously they had a null reference_id and leaked).
  const noteId = `test-ingest-route-fallthrough-${uniqueToken()}`;
  try {
    const response = await fetch(INGEST_URL, {
      method: "POST",
      headers: mcpHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        content: `Route test ${noteId} — should not hit MCP transport.`,
        note_id: noteId,
      }),
    });
    // If the MCP transport handled this, we'd get 406 with a JSON-RPC error.
    // The direct handler returns 200 with { success: true }.
    assertEquals(
      response.status,
      200,
      "Should be handled by direct route, not MCP (which would return 406)",
    );
    const body = await response.json();
    assertEquals(body.success, true);
    assertExists(body.message);
  } finally {
    await deleteIngestArtifacts(noteId);
  }
});

Deno.test("/ingest-note returns 401 without valid key", async () => {
  const response = await fetch(INGEST_URL, {
    method: "POST",
    // No x-tb-key header and no ?key= → unauthenticated.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "test" }),
  });
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, "Invalid or missing access key");
});

Deno.test("/ingest-note returns 400 when content is missing", async () => {
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: mcpHeaders({ "Content-Type": "application/json" }),
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
    headers: mcpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ content: "   " }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
  assertEquals(body.error, "content is required");
});

Deno.test("/ingest-note ingests a note and sets reliability and author", async () => {
  const noteId = `test-ingest-route-provenance-${uniqueToken()}`;
  try {
    const response = await fetch(INGEST_URL, {
      method: "POST",
      headers: mcpHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        content:
          "The ingest route test verifies that thoughts have correct provenance fields after ingestion.",
        title: "Ingest Route Test",
        note_id: noteId,
      }),
    });

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.success, true);
    assertExists(body.message);

    // Verify thoughts were created with correct reliability and author
    const thoughtsResponse = await fetch(
      restUrl(
        `thoughts?reference_id=eq.${
          encodeURIComponent(noteId)
        }&select=content,reliability,author,metadata`,
      ),
      { headers: serviceHeaders() },
    );
    assertEquals(thoughtsResponse.ok, true, "DB query should succeed");
    const thoughts: {
      content: string;
      reliability: string | null;
      author: string | null;
    }[] = await thoughtsResponse.json();

    assertEquals(
      thoughts.length > 0,
      true,
      "Should have ingested at least one thought",
    );

    for (const thought of thoughts) {
      assertEquals(
        thought.reliability,
        "less reliable",
        "reliability should be 'less reliable'",
      );
      assertEquals(
        thought.author,
        "gpt-4o-mini",
        "author should be 'gpt-4o-mini'",
      );
    }
  } finally {
    await deleteIngestArtifacts(noteId);
  }
});

// ---------------------------------------------------------------------------
// MCP tool list verification
// ---------------------------------------------------------------------------

Deno.test("ingest_note is NOT in MCP tool list", async () => {
  const registeredToolNames = await toolNames();
  assertEquals(
    registeredToolNames.includes("ingest_note"),
    false,
    `ingest_note should NOT be in tool list. Found tools: ${
      registeredToolNames.join(", ")
    }`,
  );

  // Verify other expected tools ARE still present
  assertEquals(
    registeredToolNames.includes("capture_thought"),
    true,
    "capture_thought should still be in tool list",
  );
  assertEquals(
    registeredToolNames.includes("search_thoughts"),
    true,
    "search_thoughts should still be in tool list",
  );
  assertEquals(
    registeredToolNames.includes("list_thoughts"),
    true,
    "list_thoughts should still be in tool list",
  );
});
