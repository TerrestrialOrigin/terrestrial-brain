// ─── Plugin API-client integration test (closes Q1) ──────────────────────────
// Drives the Obsidian plugin's REAL HttpTerrestrialBrainClient — imported
// straight from the plugin source, not a hand-rolled fetch copy — against the
// live local Supabase stack. This is the only test in the repo that exercises
// the plugin's actual HTTP code (URL construction, x-brain-key header, envelope
// parsing, and boundary validation) end to end, so a server response-shape
// change breaks it instead of silently passing.
//
// Requires the local stack (npx supabase start) with functions served. It fails
// loudly (no skips) if the stack is unreachable, per the zero-skips rule.

import { assert, assertEquals, assertExists } from "@std/assert";
import {
  HttpTerrestrialBrainClient,
} from "../../obsidian-plugin/src/apiClient.ts";
import {
  callTool,
  createServiceClient,
  MCP_KEY,
  SUPABASE_URL,
  uniqueToken,
} from "../helpers/mcp-client.ts";

// The plugin client sends the key via the x-brain-key header, never in the URL.
const ENDPOINT_BASE = `${SUPABASE_URL}/functions/v1/terrestrial-brain-mcp`;

// Created once at module scope (not per test) so its internal timer is not
// counted as a per-test resource leak by Deno's sanitizer.
const supabase = createServiceClient();

function makeClient(): HttpTerrestrialBrainClient {
  return new HttpTerrestrialBrainClient({
    getEndpointUrl: () => ENDPOINT_BASE,
    getAccessKey: () => MCP_KEY,
  });
}

Deno.test("plugin client ingests a note against the live stack", async () => {
  const client = makeClient();
  const noteId = `plugin-client-test/${uniqueToken()}.md`;
  try {
    const message = await client.ingestNote(
      "# Plugin Client Test\n\nRemember to buy milk and eggs tomorrow.",
      "Plugin Client Test",
      noteId,
    );
    assert(
      typeof message === "string",
      "ingestNote should return a string message",
    );
    assert(message.length > 0, "ingestNote message should be non-empty");
  } finally {
    await supabase.from("thoughts").delete().eq("reference_id", noteId);
    await supabase.from("note_snapshots").delete().eq("reference_id", noteId);
  }
});

Deno.test("plugin client polls metadata, validates, fetches content, and marks picked up", async () => {
  const client = makeClient();
  const filePath = `plugin-client-test/${uniqueToken()}.md`;
  const outputBody =
    "# Delivered By Plugin Client\n\nHello from the integration test.";

  // Setup via the MCP tool helper (not the tested path) — create a pending output.
  const createResult = await callTool("create_ai_output", {
    title: "Plugin Client Output",
    content: outputBody,
    file_path: filePath,
    source_context: "plugin-client integration test",
  });
  const outputId = createResult.match(/id: ([0-9a-f-]+)/)?.[1];
  assertExists(outputId, "create_ai_output should return an id");

  try {
    // Tested path: real client, real HTTP, boundary-validated responses.
    const metadata = await client.fetchPendingMetadata();
    const mine = metadata.find((entry) => entry.id === outputId);
    assertExists(mine, "the created output should appear in pending metadata");
    assertEquals(mine!.file_path, filePath);
    assertEquals(typeof mine!.content_size, "number");

    const content = await client.fetchContent([outputId!]);
    assertEquals(
      content.find((entry) => entry.id === outputId)?.content,
      outputBody,
    );

    const marked = await client.call("mark-ai-output-picked-up", {
      ids: [outputId],
    });
    assertEquals(
      marked.success,
      true,
      "mark-ai-output-picked-up should succeed",
    );
  } finally {
    await supabase.from("ai_output").delete().eq("id", outputId);
  }
});
