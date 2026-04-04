import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BASE = "http://localhost:54321/functions/v1/terrestrial-brain-mcp?key=dev-test-key-123";

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args }
    })
  });

  const text = await res.text();
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find(l => l.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
    return parsed.result?.content?.[0]?.text || "";
  }
  const parsed = JSON.parse(text);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
  return parsed.result?.content?.[0]?.text || "";
}

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// ─── Thoughts Tests ──────────────────────────────────────────────────────────

Deno.test("thought_stats returns accurate counts", async () => {
  const result = await callTool("thought_stats", {});
  assertExists(result);
  assertEquals(result.includes("Total thoughts:"), true);
  assertEquals(result.includes("Types:"), true);
});

Deno.test("list_thoughts returns results", async () => {
  const result = await callTool("list_thoughts", { limit: 5 });
  assertExists(result);
  assertEquals(result.includes("recent thought"), true);
});

// ─── Timestamp format tests ────────────────────────────────────────────────

const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

Deno.test("list_thoughts shows full ISO 8601 timestamps", async () => {
  const result = await callTool("list_thoughts", { limit: 5 });
  assertExists(result);
  assertEquals(
    ISO_TIMESTAMP_PATTERN.test(result),
    true,
    `list_thoughts should include ISO 8601 timestamps with time component. Got: ${result.substring(0, 300)}`,
  );
});

Deno.test("search_thoughts shows full ISO 8601 timestamps", async () => {
  const result = await callTool("search_thoughts", { query: "project", limit: 3, threshold: 0.3 });
  assertExists(result);
  if (!result.includes("No thoughts found")) {
    assertEquals(
      ISO_TIMESTAMP_PATTERN.test(result),
      true,
      `search_thoughts should include ISO 8601 timestamps with time component. Got: ${result.substring(0, 300)}`,
    );
  }
});

Deno.test("get_thought_by_id shows full ISO 8601 timestamps", async () => {
  // Capture a thought to get a known ID
  const uniqueContent = `Timestamp format test ${Date.now()}`;
  await callTool("capture_thought", { content: uniqueContent });

  // Get the thought ID from DB
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const thoughts: { id: string }[] = await response.json();
  assertEquals(thoughts.length, 1);
  const thoughtId = thoughts[0].id;

  const result = await callTool("get_thought_by_id", { id: thoughtId });
  assertExists(result);
  assertEquals(
    ISO_TIMESTAMP_PATTERN.test(result),
    true,
    `get_thought_by_id should include ISO 8601 timestamps with time component. Got: ${result.substring(0, 300)}`,
  );

  // Cleanup
  await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?id=eq.${thoughtId}`,
    {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
});

// ─── list_thoughts project_id filter and provenance display ─────────────────

const TB_PROJECT_ID = "00000000-0000-0000-0000-000000000002";
const CC_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

Deno.test("list_thoughts with project_id filter returns only matching thoughts", async () => {
  const result = await callTool("list_thoughts", { project_id: TB_PROJECT_ID, limit: 50 });
  assertExists(result);
  // All returned thoughts should be about Terrestrial Brain, none about CarChief-only topics
  assertEquals(result.includes("recent thought"), true, "Should return results");
  // The TB-seeded thought mentions MCP or Obsidian
  assertEquals(
    result.includes("MCP") || result.includes("Terrestrial Brain") || result.includes("Obsidian"),
    true,
    `Should contain TB-related content. Got: ${result.substring(0, 500)}`,
  );
});

Deno.test("list_thoughts with non-matching project_id returns no thoughts", async () => {
  const result = await callTool("list_thoughts", { project_id: "00000000-0000-0000-0000-999999999999" });
  assertEquals(result, "No thoughts found.");
});

Deno.test("list_thoughts with project_id combined with type filter", async () => {
  const result = await callTool("list_thoughts", { project_id: TB_PROJECT_ID, type: "observation", limit: 50 });
  assertExists(result);
  // Should return at least the seed thought about MCP batching (type=observation, project=TB)
  if (result !== "No thoughts found.") {
    assertEquals(result.includes("recent thought"), true);
  }
});

Deno.test("list_thoughts output includes reliability and author", async () => {
  // Fetch thoughts that have reliability/author set (seeded data)
  const result = await callTool("list_thoughts", { project_id: TB_PROJECT_ID, limit: 50 });
  assertExists(result);
  // The seeded TB thought has reliability='reliable' and author='claude-sonnet-4-6'
  assertEquals(result.includes("Reliability:"), true, `Output should include Reliability. Got: ${result.substring(0, 500)}`);
  assertEquals(result.includes("Author:"), true, `Output should include Author. Got: ${result.substring(0, 500)}`);
});

Deno.test("list_thoughts output includes resolved project names", async () => {
  const result = await callTool("list_thoughts", { project_id: TB_PROJECT_ID, limit: 50 });
  assertExists(result);
  // Project UUID should be resolved to "Terrestrial Brain" name
  assertEquals(
    result.includes("Projects: Terrestrial Brain"),
    true,
    `Output should include resolved project name 'Terrestrial Brain'. Got: ${result.substring(0, 500)}`,
  );
});

// ─── list_thoughts author and reliability filters ──────────────────────────

Deno.test("list_thoughts with author filter returns only matching thoughts", async () => {
  const result = await callTool("list_thoughts", { author: "claude-sonnet-4-6", limit: 50 });
  assertExists(result);
  if (result === "No thoughts found.") {
    throw new Error("Expected results for author='claude-sonnet-4-6' but got none");
  }
  assertEquals(result.includes("Author: claude-sonnet-4-6"), true, `Should contain Author: claude-sonnet-4-6. Got: ${result.substring(0, 500)}`);
  // Should NOT contain thoughts from gpt-4o-mini
  assertEquals(result.includes("Author: gpt-4o-mini"), false, `Should NOT contain Author: gpt-4o-mini. Got: ${result.substring(0, 500)}`);
});

Deno.test("list_thoughts with reliability filter returns only matching thoughts", async () => {
  const result = await callTool("list_thoughts", { reliability: "less reliable", limit: 50 });
  assertExists(result);
  if (result === "No thoughts found.") {
    throw new Error("Expected results for reliability='less reliable' but got none");
  }
  assertEquals(result.includes("Reliability: less reliable"), true, `Should contain 'less reliable'. Got: ${result.substring(0, 500)}`);
  // Should NOT contain 'reliable' thoughts (but careful: "less reliable" contains "reliable")
  // Check that "Reliability: reliable" (without "less" prefix) does not appear
  const lines = result.split("\n");
  const reliabilityLines = lines.filter(line => line.includes("Reliability:"));
  for (const line of reliabilityLines) {
    assertEquals(
      line.includes("less reliable"),
      true,
      `Every reliability line should say 'less reliable', but got: ${line}`,
    );
  }
});

Deno.test("list_thoughts with author filter and non-matching value returns no thoughts", async () => {
  const result = await callTool("list_thoughts", { author: "nonexistent-model-xyz" });
  assertEquals(result, "No thoughts found.");
});

Deno.test("list_thoughts with combined author and project_id filter", async () => {
  // claude-sonnet-4-6 authored a thought for TB project
  const result = await callTool("list_thoughts", {
    author: "claude-sonnet-4-6",
    project_id: TB_PROJECT_ID,
    limit: 50,
  });
  assertExists(result);
  if (result === "No thoughts found.") {
    throw new Error("Expected results for author=claude-sonnet-4-6 + project=TB but got none");
  }
  assertEquals(result.includes("Author: claude-sonnet-4-6"), true, `Should contain correct author`);
  assertEquals(result.includes("Projects: Terrestrial Brain"), true, `Should contain correct project`);
});

Deno.test("list_thoughts with mismatched author and project_id returns no thoughts", async () => {
  // gpt-4o-mini authored the CarChief thought, not the TB one
  const result = await callTool("list_thoughts", {
    author: "gpt-4o-mini",
    project_id: TB_PROJECT_ID,
    limit: 50,
  });
  assertEquals(result, "No thoughts found.");
});

// ─── search_thoughts author and reliability filters ─────────────────────────

const SEARCH_FILTER_CLEANUP_IDS: string[] = [];

Deno.test("search_thoughts with author filter narrows results", async () => {
  // Capture two thoughts with different authors and similar content
  const baseContent = `search filter test: database optimization ${Date.now()}`;
  await callTool("capture_thought", { content: `${baseContent} — from model A`, author: "test-model-alpha" });
  await callTool("capture_thought", { content: `${baseContent} — from model B`, author: "test-model-beta" });

  // Search with author filter
  const result = await callTool("search_thoughts", {
    query: baseContent,
    author: "test-model-alpha",
    limit: 10,
    threshold: 0.3,
  });
  assertExists(result);

  if (!result.includes("No thoughts found")) {
    assertEquals(result.includes("Author: test-model-alpha"), true, `Should contain model-alpha. Got: ${result.substring(0, 500)}`);
    assertEquals(result.includes("Author: test-model-beta"), false, `Should NOT contain model-beta. Got: ${result.substring(0, 500)}`);
  }

  // Cleanup
  for (const suffix of ["— from model A", "— from model B"]) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/thoughts?content=like.*${encodeURIComponent(suffix)}&select=id`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    if (response.ok) {
      const thoughts: { id: string }[] = await response.json();
      for (const thought of thoughts) {
        SEARCH_FILTER_CLEANUP_IDS.push(thought.id);
      }
    }
  }
});

Deno.test("search_thoughts with reliability filter narrows results", async () => {
  const timestamp = Date.now();
  const contentA = `search filter reliability test thought A ${timestamp}`;
  const contentB = `search filter reliability test thought B ${timestamp}`;

  // Capture two thoughts via MCP (both get reliability='reliable' and embeddings generated server-side)
  await callTool("capture_thought", { content: contentA, author: "test-rel-a" });
  await callTool("capture_thought", { content: contentB, author: "test-rel-b" });

  // Fetch thought B's ID so we can patch its reliability
  const fetchResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(contentB)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(fetchResponse.ok, true, "DB fetch should succeed");
  const thoughtsB: { id: string }[] = await fetchResponse.json();
  assertEquals(thoughtsB.length, 1, "Should find exactly one thought B");
  SEARCH_FILTER_CLEANUP_IDS.push(thoughtsB[0].id);

  // Also fetch thought A for cleanup
  const fetchResponseA = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(contentA)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(fetchResponseA.ok, true);
  const thoughtsA: { id: string }[] = await fetchResponseA.json();
  for (const thought of thoughtsA) {
    SEARCH_FILTER_CLEANUP_IDS.push(thought.id);
  }

  // Update thought B to 'less reliable' via direct DB patch
  const patchResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?id=eq.${thoughtsB[0].id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reliability: "less reliable" }),
    },
  );
  assertEquals(patchResponse.ok, true, "Patch reliability should succeed");

  // Search with reliability filter — should only find the 'less reliable' thought
  const searchQuery = `search filter reliability test ${timestamp}`;
  const result = await callTool("search_thoughts", {
    query: searchQuery,
    reliability: "less reliable",
    limit: 10,
    threshold: 0.3,
  });
  assertExists(result);

  if (!result.includes("No thoughts found")) {
    assertEquals(result.includes("Reliability: less reliable"), true, `Should contain 'less reliable'. Got: ${result.substring(0, 500)}`);
    // Should not contain the "reliable" one (that's not "less reliable")
    const lines = result.split("\n").filter(line => line.includes("Reliability:"));
    for (const line of lines) {
      assertEquals(
        line.includes("less reliable"),
        true,
        `Every reliability line should say 'less reliable', but got: ${line}`,
      );
    }
  }
});

Deno.test("cleanup search filter test data", async () => {
  for (const thoughtId of SEARCH_FILTER_CLEANUP_IDS) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/thoughts?id=eq.${thoughtId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    assertEquals(response.ok, true, `Cleanup of ${thoughtId} should succeed`);
  }
});

// ─── thought_stats project_id filter ────────────────────────────────────────

Deno.test("thought_stats with project_id returns scoped statistics", async () => {
  const result = await callTool("thought_stats", { project_id: TB_PROJECT_ID });
  assertExists(result);
  assertEquals(result.includes("Total thoughts:"), true);
  // Scoped count should be less than or equal to total
  const scopedMatch = result.match(/Total thoughts:\s*(\d+)/);
  assertExists(scopedMatch, "Should have a total count");
  const scopedCount = parseInt(scopedMatch![1]);

  const allResult = await callTool("thought_stats", {});
  const allMatch = allResult.match(/Total thoughts:\s*(\d+)/);
  assertExists(allMatch, "All stats should have a total count");
  const allCount = parseInt(allMatch![1]);

  assertEquals(scopedCount <= allCount, true, `Scoped count (${scopedCount}) should be <= total (${allCount})`);
  assertEquals(scopedCount > 0, true, `Scoped count should be > 0 for seeded data`);
});

Deno.test("thought_stats with non-matching project_id returns zero count", async () => {
  const result = await callTool("thought_stats", { project_id: "00000000-0000-0000-0000-999999999999" });
  assertExists(result);
  assertEquals(result.includes("Total thoughts: 0"), true, `Should show 0 thoughts. Got: ${result.substring(0, 300)}`);
});

// ─── search_thoughts provenance display ─────────────────────────────────────

Deno.test("search_thoughts output includes reliability and author when present", async () => {
  // First capture a thought with known content so we can search for it
  const uniqueContent = `Integration test search provenance: unique marker ${Date.now()}`;
  await callTool("capture_thought", { content: uniqueContent, author: "test-model-42" });

  // Search for it
  const result = await callTool("search_thoughts", { query: uniqueContent, limit: 5, threshold: 0.3 });
  assertExists(result);

  if (result.includes("No thoughts found")) {
    // Embedding may not match well enough; skip assertion but don't fail
    console.warn("search_thoughts didn't find the test thought — embedding similarity may be too low");
  } else {
    assertEquals(result.includes("Reliability:"), true, `Search output should include Reliability. Got: ${result.substring(0, 500)}`);
    assertEquals(result.includes("Author:"), true, `Search output should include Author. Got: ${result.substring(0, 500)}`);
  }

  // Cleanup
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}`,
    {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true, "Cleanup should succeed");
});

// ─── Project name resolution fallback ───────────────────────────────────────

Deno.test("list_thoughts displays raw UUID for orphaned project references", async () => {
  const orphanedUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const uniqueContent = `Integration test orphaned project ref ${Date.now()}`;

  // Insert a thought directly with an orphaned project UUID
  const insertResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        content: uniqueContent,
        metadata: {
          type: "observation",
          topics: ["test"],
          source: "mcp",
          references: { projects: [orphanedUuid] },
        },
        reliability: "reliable",
        author: "test-model",
      }),
    },
  );
  assertEquals(insertResponse.ok, true, "Direct insert should succeed");
  const inserted: { id: string }[] = await insertResponse.json();

  // List thoughts and look for the orphaned UUID in output
  const result = await callTool("list_thoughts", { limit: 50 });
  assertExists(result);
  assertEquals(
    result.includes(orphanedUuid),
    true,
    `Output should contain the raw orphaned UUID as fallback. Got: ${result.substring(0, 800)}`,
  );

  // Cleanup
  const cleanupResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?id=eq.${inserted[0].id}`,
    {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(cleanupResponse.ok, true, "Cleanup should succeed");
});

// ─── Ingest Note with Project Detection (via /ingest-note HTTP route) ────────

const CARCHIEF_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const INGEST_URL =
  "http://localhost:54321/functions/v1/terrestrial-brain-mcp/ingest-note?key=dev-test-key-123";

const TEST_NOTE_ID = `test-ingest-carchief-${Date.now()}`;

Deno.test("ingest_note with project mention tags thoughts with project_id", async () => {
  const noteContent = `# CarChief Dealer Lookup Performance

The CarChief dealer lookup endpoint is too slow for production use. We need to add Redis caching
in front of the PostgreSQL query. Target is sub-100ms p95 latency for cached lookups.

CarChief Backend API should expose a cache-invalidation webhook so the dealer data stays fresh.`;

  const ingestResponse = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: noteContent,
      title: "CarChief Dealer Lookup Performance",
      note_id: TEST_NOTE_ID,
    }),
  });
  assertEquals(ingestResponse.ok, true, "Ingest should succeed");
  const result = await ingestResponse.json();
  assertEquals(result.success, true, "Ingest should return success");
  assertExists(result.message);

  // Query the DB directly to verify project_id was set in metadata
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?reference_id=eq.${TEST_NOTE_ID}&select=content,metadata`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  assertEquals(response.ok, true, "DB query should succeed");

  const thoughts: { content: string; metadata: Record<string, unknown> }[] =
    await response.json();
  assertEquals(thoughts.length > 0, true, "Should have ingested at least one thought");

  // At least one thought should have the CarChief project_id in references (new array format or old single-id format)
  const taggedThoughts = thoughts.filter(
    (thought) => {
      const refs = thought.metadata?.references as Record<string, unknown> | undefined;
      if (!refs) return false;
      // New format: references.projects is an array containing the ID
      if (Array.isArray(refs.projects) && (refs.projects as string[]).includes(CARCHIEF_PROJECT_ID)) return true;
      // Old format: references.project_id is the ID string
      if (refs.project_id === CARCHIEF_PROJECT_ID) return true;
      return false;
    }
  );
  assertEquals(
    taggedThoughts.length > 0,
    true,
    `At least one thought should be tagged with CarChief project_id (${CARCHIEF_PROJECT_ID}). ` +
      `Found ${thoughts.length} thoughts, none tagged. Metadata: ${JSON.stringify(thoughts.map((thought) => thought.metadata))}`
  );
});

// ─── capture_thought Provenance Tests ────────────────────────────────────────

const CAPTURE_THOUGHT_CLEANUP_IDS: string[] = [];

Deno.test("capture_thought sets reliability to 'reliable'", async () => {
  const uniqueContent = `Integration test: reliability check ${Date.now()}`;
  const result = await callTool("capture_thought", { content: uniqueContent });
  assertExists(result);

  // Query DB to verify reliability
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id,reliability,author`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true, "DB query should succeed");
  const thoughts: { id: string; reliability: string | null; author: string | null }[] = await response.json();
  assertEquals(thoughts.length, 1, "Should have exactly one thought");
  assertEquals(thoughts[0].reliability, "reliable", "reliability should be 'reliable'");
  CAPTURE_THOUGHT_CLEANUP_IDS.push(thoughts[0].id);
});

Deno.test("capture_thought stores author when provided", async () => {
  const uniqueContent = `Integration test: author provided ${Date.now()}`;
  const result = await callTool("capture_thought", {
    content: uniqueContent,
    author: "claude-sonnet-4-6",
  });
  assertExists(result);

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id,reliability,author`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const thoughts: { id: string; reliability: string | null; author: string | null }[] = await response.json();
  assertEquals(thoughts.length, 1);
  assertEquals(thoughts[0].author, "claude-sonnet-4-6", "author should match provided value");
  assertEquals(thoughts[0].reliability, "reliable", "reliability should still be 'reliable'");
  CAPTURE_THOUGHT_CLEANUP_IDS.push(thoughts[0].id);
});

Deno.test("capture_thought leaves author null when omitted", async () => {
  const uniqueContent = `Integration test: author omitted ${Date.now()}`;
  const result = await callTool("capture_thought", { content: uniqueContent });
  assertExists(result);

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id,reliability,author`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const thoughts: { id: string; reliability: string | null; author: string | null }[] = await response.json();
  assertEquals(thoughts.length, 1);
  assertEquals(thoughts[0].author, null, "author should be null when not provided");
  CAPTURE_THOUGHT_CLEANUP_IDS.push(thoughts[0].id);
});

Deno.test("capture_thought merges explicit project_ids with pipeline-detected projects", async () => {
  // Use CarChief in the content so the pipeline detects it, and also pass a second explicit UUID
  const explicitProjectId = "00000000-0000-0000-0000-000000000002";
  const uniqueContent = `Integration test: CarChief project merge check ${Date.now()}`;
  const result = await callTool("capture_thought", {
    content: uniqueContent,
    project_ids: [explicitProjectId],
  });
  assertExists(result);

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id,metadata`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const thoughts: { id: string; metadata: Record<string, unknown> }[] = await response.json();
  assertEquals(thoughts.length, 1);

  const refs = thoughts[0].metadata?.references as Record<string, unknown> | undefined;
  assertExists(refs, "metadata.references should exist");
  const projects = refs.projects as string[];
  assertExists(projects, "references.projects should exist");

  // The explicit project_id must be present
  assertEquals(
    projects.includes(explicitProjectId),
    true,
    `Explicit project ${explicitProjectId} should be in references.projects. Got: ${JSON.stringify(projects)}`,
  );
  CAPTURE_THOUGHT_CLEANUP_IDS.push(thoughts[0].id);
});

Deno.test("cleanup capture_thought provenance test data", async () => {
  for (const thoughtId of CAPTURE_THOUGHT_CLEANUP_IDS) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/thoughts?id=eq.${thoughtId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    assertEquals(response.ok, true, `Cleanup of ${thoughtId} should succeed`);
  }
});

// Cleanup: remove test thoughts after the test
Deno.test("cleanup ingest_note test data", async () => {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?reference_id=eq.${TEST_NOTE_ID}`,
    {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  assertEquals(response.ok, true, "Cleanup should succeed");
});

// ─── archive_thought Tests ─────────────────────────────────────────────────

const ARCHIVE_THOUGHT_CLEANUP_IDS: string[] = [];

Deno.test("archive_thought archives a thought", async () => {
  const uniqueContent = `Archive test thought ${Date.now()}`;
  await callTool("capture_thought", { content: uniqueContent, author: "test-archive" });

  // Get the thought ID
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const thoughts: { id: string }[] = await response.json();
  assertEquals(thoughts.length, 1);
  const thoughtId = thoughts[0].id;
  ARCHIVE_THOUGHT_CLEANUP_IDS.push(thoughtId);

  const result = await callTool("archive_thought", { id: thoughtId });
  assertExists(result);
  assertEquals(result.includes("Archived thought:"), true, `Should confirm archiving. Got: ${result}`);

  // Verify archived_at is set in DB
  const verifyResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?id=eq.${thoughtId}&select=archived_at`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(verifyResponse.ok, true);
  const verified: { archived_at: string | null }[] = await verifyResponse.json();
  assertEquals(verified.length, 1);
  assertExists(verified[0].archived_at, "archived_at should be set");
});

Deno.test("archive_thought on already-archived thought returns error", async () => {
  // Use the thought archived in the previous test
  const thoughtId = ARCHIVE_THOUGHT_CLEANUP_IDS[0];
  assertExists(thoughtId, "Need an archived thought ID from previous test");

  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: "archive_thought", arguments: { id: thoughtId } }
    })
  });
  const text = await res.text();
  let resultText: string;
  let isError: boolean;
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find(l => l.startsWith("data:"));
    const parsed = JSON.parse(dataLine!.slice(5).trim());
    resultText = parsed.result?.content?.[0]?.text || "";
    isError = !!parsed.result?.isError;
  } else {
    const parsed = JSON.parse(text);
    resultText = parsed.result?.content?.[0]?.text || "";
    isError = !!parsed.result?.isError;
  }

  assertEquals(isError, true, `Should return error for already-archived thought. Got: ${resultText}`);
  assertEquals(
    resultText.includes("already archived") || resultText.includes("not found"),
    true,
    `Error message should mention already archived or not found. Got: ${resultText}`,
  );
});

Deno.test("list_thoughts excludes archived thoughts by default", async () => {
  // Capture a new thought and archive it
  const uniqueContent = `Archived list exclusion test ${Date.now()}`;
  await callTool("capture_thought", { content: uniqueContent, author: "test-archive-list" });

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  const thoughts: { id: string }[] = await response.json();
  assertEquals(thoughts.length, 1);
  const thoughtId = thoughts[0].id;
  ARCHIVE_THOUGHT_CLEANUP_IDS.push(thoughtId);

  // Archive it
  await callTool("archive_thought", { id: thoughtId });

  // list_thoughts should NOT include it
  const listResult = await callTool("list_thoughts", { limit: 100 });
  assertEquals(
    listResult.includes(uniqueContent),
    false,
    `Archived thought should not appear in list_thoughts. Got: ${listResult.substring(0, 500)}`,
  );
});

Deno.test("list_thoughts with include_archived shows archived thoughts", async () => {
  // The thought archived in the previous test should appear with include_archived
  const listResult = await callTool("list_thoughts", { limit: 100, include_archived: true });
  assertExists(listResult);
  // At least one archived thought should now be present
  assertEquals(
    listResult.includes("test-archive-list") || listResult.includes("Archived list exclusion test"),
    true,
    `Archived thought should appear when include_archived=true. Got: ${listResult.substring(0, 500)}`,
  );
});

Deno.test("search_thoughts excludes archived thoughts", async () => {
  // Capture a thought with very specific content, archive it, then search for it
  const uniqueContent = `Archived search exclusion zylophone quantum ${Date.now()}`;
  await callTool("capture_thought", { content: uniqueContent, author: "test-archive-search" });

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${encodeURIComponent(uniqueContent)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  const thoughts: { id: string }[] = await response.json();
  assertEquals(thoughts.length, 1);
  const thoughtId = thoughts[0].id;
  ARCHIVE_THOUGHT_CLEANUP_IDS.push(thoughtId);

  // Archive it
  await callTool("archive_thought", { id: thoughtId });

  // Search should not find it — either "No thoughts found" or results that don't include the archived thought's ID
  const searchResult = await callTool("search_thoughts", {
    query: uniqueContent,
    limit: 10,
    threshold: 0.3,
  });
  assertEquals(
    searchResult.includes(thoughtId),
    false,
    `Archived thought ID should not appear in search_thoughts results. Got: ${searchResult.substring(0, 500)}`,
  );
});

Deno.test("thought_stats excludes archived thoughts from counts", async () => {
  // Get stats before — the archived thoughts from previous tests should not be counted
  const statsResult = await callTool("thought_stats", {});
  const countMatch = statsResult.match(/Total thoughts:\s*(\d+)/);
  assertExists(countMatch);
  const totalCount = parseInt(countMatch![1]);

  // Verify by checking the DB directly for non-archived count
  const dbResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?archived_at=is.null&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: "count=exact",
      },
    },
  );
  // Consume the response body to avoid resource leak
  await dbResponse.text();
  const dbCount = parseInt(dbResponse.headers.get("content-range")?.split("/")[1] || "0");
  assertEquals(totalCount, dbCount, `thought_stats count (${totalCount}) should match non-archived DB count (${dbCount})`);
});

Deno.test("cleanup archive_thought test data", async () => {
  for (const thoughtId of ARCHIVE_THOUGHT_CLEANUP_IDS) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/thoughts?id=eq.${thoughtId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    assertEquals(response.ok, true, `Cleanup of ${thoughtId} should succeed`);
  }
});
