import { assertEquals, assertExists } from "@std/assert";
import {
  callTool,
  callToolRaw,
  mcpHeaders,
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
} from "../helpers/mcp-client.ts";

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
    `list_thoughts should include ISO 8601 timestamps with time component. Got: ${
      result.substring(0, 300)
    }`,
  );
});

Deno.test("search_thoughts shows full ISO 8601 timestamps", async () => {
  // Self-contained: capture a thought, then search for its own content so the
  // deterministic fake embedding reliably returns it (no LLM-availability hedge).
  const uniqueContent = `ISO timestamp search marker aardvark ${Date.now()}`;
  await callTool("capture_thought", { content: uniqueContent });

  const result = await callTool("search_thoughts", {
    query: uniqueContent,
    limit: 3,
    threshold: 0.3,
  });
  assertExists(result);
  assertEquals(
    result.includes("No thoughts found"),
    false,
    `Expected a match. Got: ${result.substring(0, 300)}`,
  );
  assertEquals(
    ISO_TIMESTAMP_PATTERN.test(result),
    true,
    `search_thoughts should include ISO 8601 timestamps with time component. Got: ${
      result.substring(0, 300)
    }`,
  );

  // Cleanup
  await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }`,
    {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
});

Deno.test("get_thought_by_id shows full ISO 8601 timestamps", async () => {
  // Capture a thought to get a known ID
  const uniqueContent = `Timestamp format test ${Date.now()}`;
  await callTool("capture_thought", { content: uniqueContent });

  // Get the thought ID from DB
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id`,
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
    `get_thought_by_id should include ISO 8601 timestamps with time component. Got: ${
      result.substring(0, 300)
    }`,
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

Deno.test("list_thoughts with project_id filter returns only matching thoughts", async () => {
  const result = await callTool("list_thoughts", {
    project_id: TB_PROJECT_ID,
    limit: 50,
  });
  assertExists(result);
  // All returned thoughts should be about Terrestrial Brain, none about Test Proj-only topics
  assertEquals(
    result.includes("recent thought"),
    true,
    "Should return results",
  );
  // The TB-seeded thought mentions MCP or Obsidian
  assertEquals(
    result.includes("MCP") || result.includes("Terrestrial Brain") ||
      result.includes("Obsidian"),
    true,
    `Should contain TB-related content. Got: ${result.substring(0, 500)}`,
  );
});

Deno.test("list_thoughts with non-matching project_id returns no thoughts", async () => {
  const result = await callTool("list_thoughts", {
    project_id: "00000000-0000-0000-0000-999999999999",
  });
  assertEquals(result, "No thoughts found.");
});

Deno.test("list_thoughts with project_id combined with type filter", async () => {
  const result = await callTool("list_thoughts", {
    project_id: TB_PROJECT_ID,
    type: "observation",
    limit: 50,
  });
  assertExists(result);
  // Seed guarantees the TB observation thought (MCP batching), so this is a hard
  // assertion — list_thoughts is not LLM-dependent.
  assertEquals(
    result.includes("No thoughts found"),
    false,
    `Expected the seeded TB observation thought. Got: ${
      result.substring(0, 300)
    }`,
  );
  assertEquals(result.includes("recent thought"), true);
});

Deno.test("list_thoughts output includes reliability and author", async () => {
  // Fetch thoughts that have reliability/author set (seeded data)
  const result = await callTool("list_thoughts", {
    project_id: TB_PROJECT_ID,
    limit: 50,
  });
  assertExists(result);
  // The seeded TB thought has reliability='reliable' and author='claude-sonnet-4-6'
  assertEquals(
    result.includes("Reliability:"),
    true,
    `Output should include Reliability. Got: ${result.substring(0, 500)}`,
  );
  assertEquals(
    result.includes("Author:"),
    true,
    `Output should include Author. Got: ${result.substring(0, 500)}`,
  );
});

Deno.test("list_thoughts output includes resolved project names", async () => {
  const result = await callTool("list_thoughts", {
    project_id: TB_PROJECT_ID,
    limit: 50,
  });
  assertExists(result);
  // Project UUID should be resolved to "Terrestrial Brain" name
  assertEquals(
    result.includes("Projects: Terrestrial Brain"),
    true,
    `Output should include resolved project name 'Terrestrial Brain'. Got: ${
      result.substring(0, 500)
    }`,
  );
});

// ─── list_thoughts author and reliability filters ──────────────────────────

Deno.test("list_thoughts with author filter returns only matching thoughts", async () => {
  const result = await callTool("list_thoughts", {
    author: "claude-sonnet-4-6",
    limit: 50,
  });
  assertExists(result);
  assertEquals(
    result.includes("No thoughts found"),
    false,
    "Expected results for author='claude-sonnet-4-6' but got none",
  );
  assertEquals(
    result.includes("Author: claude-sonnet-4-6"),
    true,
    `Should contain Author: claude-sonnet-4-6. Got: ${
      result.substring(0, 500)
    }`,
  );
  // Should NOT contain thoughts from gpt-4o-mini
  assertEquals(
    result.includes("Author: gpt-4o-mini"),
    false,
    `Should NOT contain Author: gpt-4o-mini. Got: ${result.substring(0, 500)}`,
  );
});

Deno.test("list_thoughts with reliability filter returns only matching thoughts", async () => {
  const result = await callTool("list_thoughts", {
    reliability: "less reliable",
    limit: 50,
  });
  assertExists(result);
  assertEquals(
    result.includes("No thoughts found"),
    false,
    "Expected results for reliability='less reliable' but got none",
  );
  assertEquals(
    result.includes("Reliability: less reliable"),
    true,
    `Should contain 'less reliable'. Got: ${result.substring(0, 500)}`,
  );
  // Should NOT contain 'reliable' thoughts (but careful: "less reliable" contains "reliable")
  // Check that "Reliability: reliable" (without "less" prefix) does not appear
  const lines = result.split("\n");
  const reliabilityLines = lines.filter((line) =>
    line.includes("Reliability:")
  );
  for (const line of reliabilityLines) {
    assertEquals(
      line.includes("less reliable"),
      true,
      `Every reliability line should say 'less reliable', but got: ${line}`,
    );
  }
});

Deno.test("list_thoughts with author filter and non-matching value returns no thoughts", async () => {
  const result = await callTool("list_thoughts", {
    author: "nonexistent-model-xyz",
  });
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
  assertEquals(
    result.includes("No thoughts found"),
    false,
    "Expected results for author=claude-sonnet-4-6 + project=TB but got none",
  );
  assertEquals(
    result.includes("Author: claude-sonnet-4-6"),
    true,
    `Should contain correct author`,
  );
  assertEquals(
    result.includes("Projects: Terrestrial Brain"),
    true,
    `Should contain correct project`,
  );
});

Deno.test("list_thoughts with mismatched author and project_id returns no thoughts", async () => {
  // gpt-4o-mini authored the Test Proj thought, not the TB one
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
  await callTool("capture_thought", {
    content: `${baseContent} — from model A`,
    author: "test-model-alpha",
  });
  await callTool("capture_thought", {
    content: `${baseContent} — from model B`,
    author: "test-model-beta",
  });

  // Search with author filter
  const result = await callTool("search_thoughts", {
    query: baseContent,
    author: "test-model-alpha",
    limit: 10,
    threshold: 0.3,
  });
  assertExists(result);

  // Query shares all its words with the captured thoughts, so the deterministic
  // fake embedding matches — a hard assertion, not skipped when empty.
  assertEquals(
    result.includes("No thoughts found"),
    false,
    `Expected the author-filtered match. Got: ${result.substring(0, 500)}`,
  );
  assertEquals(
    result.includes("Author: test-model-alpha"),
    true,
    `Should contain model-alpha. Got: ${result.substring(0, 500)}`,
  );
  assertEquals(
    result.includes("Author: test-model-beta"),
    false,
    `Should NOT contain model-beta. Got: ${result.substring(0, 500)}`,
  );

  // Cleanup
  for (const suffix of ["— from model A", "— from model B"]) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/thoughts?content=like.*${
        encodeURIComponent(suffix)
      }&select=id`,
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
  await callTool("capture_thought", {
    content: contentA,
    author: "test-rel-a",
  });
  await callTool("capture_thought", {
    content: contentB,
    author: "test-rel-b",
  });

  // Fetch thought B's ID so we can patch its reliability
  const fetchResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(contentB)
    }&select=id`,
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
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(contentA)
    }&select=id`,
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

  // Both thoughts share the query's words, so the fake embedding matches; the
  // reliability filter must then leave only the 'less reliable' one.
  assertEquals(
    result.includes("No thoughts found"),
    false,
    `Expected the reliability-filtered match. Got: ${result.substring(0, 500)}`,
  );
  assertEquals(
    result.includes("Reliability: less reliable"),
    true,
    `Should contain 'less reliable'. Got: ${result.substring(0, 500)}`,
  );
  // Should not contain the "reliable" one (that's not "less reliable")
  const lines = result.split("\n").filter((line) =>
    line.includes("Reliability:")
  );
  for (const line of lines) {
    assertEquals(
      line.includes("less reliable"),
      true,
      `Every reliability line should say 'less reliable', but got: ${line}`,
    );
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

  assertEquals(
    scopedCount <= allCount,
    true,
    `Scoped count (${scopedCount}) should be <= total (${allCount})`,
  );
  assertEquals(
    scopedCount > 0,
    true,
    `Scoped count should be > 0 for seeded data`,
  );
});

Deno.test("thought_stats with non-matching project_id returns zero count", async () => {
  const result = await callTool("thought_stats", {
    project_id: "00000000-0000-0000-0000-999999999999",
  });
  assertExists(result);
  assertEquals(
    result.includes("Total thoughts: 0"),
    true,
    `Should show 0 thoughts. Got: ${result.substring(0, 300)}`,
  );
});

// ─── search_thoughts provenance display ─────────────────────────────────────

Deno.test("search_thoughts output includes reliability and author when present", async () => {
  // First capture a thought with known content so we can search for it
  const uniqueContent =
    `Integration test search provenance: unique marker ${Date.now()}`;
  await callTool("capture_thought", {
    content: uniqueContent,
    author: "test-model-42",
  });

  // Search for it
  const result = await callTool("search_thoughts", {
    query: uniqueContent,
    limit: 5,
    threshold: 0.3,
  });
  assertExists(result);

  // Searching for the just-captured content matches deterministically against
  // the fake embedding — a hard assertion, never a silent skip.
  assertEquals(
    result.includes("No thoughts found"),
    false,
    `Expected to find the just-captured thought. Got: ${
      result.substring(0, 500)
    }`,
  );
  assertEquals(
    result.includes("Reliability:"),
    true,
    `Search output should include Reliability. Got: ${
      result.substring(0, 500)
    }`,
  );
  assertEquals(
    result.includes("Author:"),
    true,
    `Search output should include Author. Got: ${result.substring(0, 500)}`,
  );

  // Cleanup
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }`,
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
    `Output should contain the raw orphaned UUID as fallback. Got: ${
      result.substring(0, 800)
    }`,
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

const TEST_PROJ_ID = "00000000-0000-0000-0000-000000000001";
const INGEST_URL =
  "http://localhost:54321/functions/v1/terrestrial-brain-mcp/ingest-note";

const TEST_NOTE_ID = `test-ingest-test-proj-${Date.now()}`;

Deno.test("ingest_note with project mention tags thoughts with project_id", async () => {
  const noteContent = `# Test Proj Record Lookup Performance

The Test Proj record lookup endpoint is too slow for production use. We need to add response caching
in front of the PostgreSQL query. Target is sub-100ms p95 latency for cached lookups.

Test Proj Backend API should expose a cache-invalidation webhook so the record data stays fresh.`;

  const ingestResponse = await fetch(INGEST_URL, {
    method: "POST",
    headers: mcpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      content: noteContent,
      title: "Test Proj Record Lookup Performance",
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
    },
  );
  assertEquals(response.ok, true, "DB query should succeed");

  const thoughts: { content: string; metadata: Record<string, unknown> }[] =
    await response.json();
  assertEquals(
    thoughts.length > 0,
    true,
    "Should have ingested at least one thought",
  );

  // At least one thought should have the Test Proj project_id in references (new array format or old single-id format)
  const taggedThoughts = thoughts.filter(
    (thought) => {
      const refs = thought.metadata?.references as
        | Record<string, unknown>
        | undefined;
      if (!refs) return false;
      // New format: references.projects is an array containing the ID
      if (
        Array.isArray(refs.projects) &&
        (refs.projects as string[]).includes(TEST_PROJ_ID)
      ) return true;
      // Old format: references.project_id is the ID string
      if (refs.project_id === TEST_PROJ_ID) return true;
      return false;
    },
  );
  assertEquals(
    taggedThoughts.length > 0,
    true,
    `At least one thought should be tagged with Test Proj project_id (${TEST_PROJ_ID}). ` +
      `Found ${thoughts.length} thoughts, none tagged. Metadata: ${
        JSON.stringify(thoughts.map((thought) => thought.metadata))
      }`,
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
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id,reliability,author`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true, "DB query should succeed");
  const thoughts: {
    id: string;
    reliability: string | null;
    author: string | null;
  }[] = await response.json();
  assertEquals(thoughts.length, 1, "Should have exactly one thought");
  assertEquals(
    thoughts[0].reliability,
    "reliable",
    "reliability should be 'reliable'",
  );
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
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id,reliability,author`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const thoughts: {
    id: string;
    reliability: string | null;
    author: string | null;
  }[] = await response.json();
  assertEquals(thoughts.length, 1);
  assertEquals(
    thoughts[0].author,
    "claude-sonnet-4-6",
    "author should match provided value",
  );
  assertEquals(
    thoughts[0].reliability,
    "reliable",
    "reliability should still be 'reliable'",
  );
  CAPTURE_THOUGHT_CLEANUP_IDS.push(thoughts[0].id);
});

Deno.test("capture_thought leaves author null when omitted", async () => {
  const uniqueContent = `Integration test: author omitted ${Date.now()}`;
  const result = await callTool("capture_thought", { content: uniqueContent });
  assertExists(result);

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id,reliability,author`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const thoughts: {
    id: string;
    reliability: string | null;
    author: string | null;
  }[] = await response.json();
  assertEquals(thoughts.length, 1);
  assertEquals(
    thoughts[0].author,
    null,
    "author should be null when not provided",
  );
  CAPTURE_THOUGHT_CLEANUP_IDS.push(thoughts[0].id);
});

Deno.test("capture_thought merges explicit project_ids with pipeline-detected projects", async () => {
  // Use Test Proj in the content so the pipeline detects it, and also pass a second explicit UUID
  const explicitProjectId = "00000000-0000-0000-0000-000000000002";
  const uniqueContent =
    `Integration test: Test Proj project merge check ${Date.now()}`;
  const result = await callTool("capture_thought", {
    content: uniqueContent,
    project_ids: [explicitProjectId],
  });
  assertExists(result);

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id,metadata`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const thoughts: { id: string; metadata: Record<string, unknown> }[] =
    await response.json();
  assertEquals(thoughts.length, 1);

  const refs = thoughts[0].metadata?.references as
    | Record<string, unknown>
    | undefined;
  assertExists(refs, "metadata.references should exist");
  const projects = refs.projects as string[];
  assertExists(projects, "references.projects should exist");

  // The explicit project_id must be present
  assertEquals(
    projects.includes(explicitProjectId),
    true,
    `Explicit project ${explicitProjectId} should be in references.projects. Got: ${
      JSON.stringify(projects)
    }`,
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
    },
  );
  assertEquals(response.ok, true, "Cleanup should succeed");
});

// ─── archive_thought Tests ─────────────────────────────────────────────────

const ARCHIVE_THOUGHT_CLEANUP_IDS: string[] = [];

Deno.test("archive_thought archives a thought", async () => {
  const uniqueContent = `Archive test thought ${Date.now()}`;
  await callTool("capture_thought", {
    content: uniqueContent,
    author: "test-archive",
  });

  // Get the thought ID
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id`,
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
  assertEquals(
    result.includes("Archived thought:"),
    true,
    `Should confirm archiving. Got: ${result}`,
  );

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
  const verified: { archived_at: string | null }[] = await verifyResponse
    .json();
  assertEquals(verified.length, 1);
  assertExists(verified[0].archived_at, "archived_at should be set");
});

Deno.test("archive_thought on already-archived thought returns error", async () => {
  // Self-contained: create and archive our own thought, then archive it again.
  const uniqueContent = `Already-archived test thought ${Date.now()}`;
  await callTool("capture_thought", {
    content: uniqueContent,
    author: "test-archive-twice",
  });

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id`,
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

  // First archive succeeds.
  await callTool("archive_thought", { id: thoughtId });

  // Second archive on the now-archived thought must return an error.
  const { text: resultText, isError } = await callToolRaw("archive_thought", {
    id: thoughtId,
  });

  assertEquals(
    isError,
    true,
    `Should return error for already-archived thought. Got: ${resultText}`,
  );
  assertEquals(
    resultText.includes("already archived") || resultText.includes("not found"),
    true,
    `Error message should mention already archived or not found. Got: ${resultText}`,
  );
});

Deno.test("list_thoughts excludes archived thoughts by default", async () => {
  // Capture a new thought and archive it
  const uniqueContent = `Archived list exclusion test ${Date.now()}`;
  await callTool("capture_thought", {
    content: uniqueContent,
    author: "test-archive-list",
  });

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id`,
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
    `Archived thought should not appear in list_thoughts. Got: ${
      listResult.substring(0, 500)
    }`,
  );
});

Deno.test("list_thoughts with include_archived shows archived thoughts", async () => {
  // The thought archived in the previous test should appear with include_archived
  const listResult = await callTool("list_thoughts", {
    limit: 100,
    include_archived: true,
  });
  assertExists(listResult);
  // At least one archived thought should now be present
  assertEquals(
    listResult.includes("test-archive-list") ||
      listResult.includes("Archived list exclusion test"),
    true,
    `Archived thought should appear when include_archived=true. Got: ${
      listResult.substring(0, 500)
    }`,
  );
});

Deno.test("search_thoughts excludes archived thoughts", async () => {
  // Capture a thought with very specific content, archive it, then search for it
  const uniqueContent =
    `Archived search exclusion zylophone quantum ${Date.now()}`;
  await callTool("capture_thought", {
    content: uniqueContent,
    author: "test-archive-search",
  });

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(uniqueContent)
    }&select=id`,
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
    `Archived thought ID should not appear in search_thoughts results. Got: ${
      searchResult.substring(0, 500)
    }`,
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
  const dbCount = parseInt(
    dbResponse.headers.get("content-range")?.split("/")[1] || "0",
  );
  assertEquals(
    totalCount,
    dbCount,
    `thought_stats count (${totalCount}) should match non-archived DB count (${dbCount})`,
  );
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

// ─── Usefulness Feedback Loop Tests ─────────────────────────────────────────

const USEFULNESS_CLEANUP_IDS: string[] = [];

async function captureAndGetId(
  content: string,
  author = "test-usefulness",
): Promise<string> {
  await callTool("capture_thought", { content, author });
  return await lookupThoughtId(content);
}

async function lookupThoughtId(content: string): Promise<string> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=eq.${
      encodeURIComponent(content)
    }&select=id`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const rows: { id: string }[] = await response.json();
  assertEquals(
    rows.length,
    1,
    `Should find exactly one thought with content "${content}"`,
  );
  return rows[0].id;
}

async function getUsefulnessScore(thoughtId: string): Promise<number> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?id=eq.${thoughtId}&select=usefulness_score`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const rows: { usefulness_score: number }[] = await response.json();
  assertEquals(rows.length, 1, `Should find thought ${thoughtId}`);
  return rows[0].usefulness_score;
}

Deno.test("record_useful_thoughts bumps scores for real UUIDs", async () => {
  const idA = await captureAndGetId(`Usefulness real A ${Date.now()}`);
  const idB = await captureAndGetId(`Usefulness real B ${Date.now()}`);
  USEFULNESS_CLEANUP_IDS.push(idA, idB);

  const baselineA = await getUsefulnessScore(idA);
  const baselineB = await getUsefulnessScore(idB);

  const result = await callTool("record_useful_thoughts", {
    thought_ids: [idA, idB],
  });
  assertEquals(
    result,
    "Recorded usefulness for 2 thought(s) out of 2 provided.",
    `Expected standard confirmation. Got: ${result}`,
  );

  assertEquals(await getUsefulnessScore(idA), baselineA + 1);
  assertEquals(await getUsefulnessScore(idB), baselineB + 1);
});

Deno.test("record_useful_thoughts accepts empty array without error", async () => {
  const result = await callTool("record_useful_thoughts", { thought_ids: [] });
  assertEquals(
    result,
    "Recorded usefulness for 0 thought(s) out of 0 provided.",
    `Empty array should return zero-count confirmation. Got: ${result}`,
  );
});

Deno.test("record_useful_thoughts with mix of real and unknown UUIDs bumps only real", async () => {
  const realId = await captureAndGetId(`Usefulness mix real ${Date.now()}`);
  USEFULNESS_CLEANUP_IDS.push(realId);
  const unknownId = "ffffffff-ffff-ffff-ffff-ffffffffffff";

  const baseline = await getUsefulnessScore(realId);

  const result = await callTool("record_useful_thoughts", {
    thought_ids: [realId, unknownId],
  });
  assertEquals(
    result,
    "Recorded usefulness for 1 thought(s) out of 2 provided.",
    `Expected 1-of-2 confirmation. Got: ${result}`,
  );

  assertEquals(await getUsefulnessScore(realId), baseline + 1);
});

Deno.test("search_thoughts payload starts with usefulness header and omits legacy footer", async () => {
  const uniqueContent = `Usefulness header search marker quokka ${Date.now()}`;
  const newId = await captureAndGetId(uniqueContent, "test-usefulness-header");
  USEFULNESS_CLEANUP_IDS.push(newId);

  const result = await callTool("search_thoughts", {
    query: uniqueContent,
    limit: 5,
    threshold: 0.3,
  });
  assertExists(result);

  assertEquals(
    result.includes("No thoughts found"),
    false,
    `Expected to find the just-captured thought "${uniqueContent}" but got "No thoughts found".`,
  );

  assertEquals(
    result.startsWith("⚠️ REQUIRED BEFORE NEXT USER RESPONSE:"),
    true,
    `Payload must start with the header prefix. Got: ${
      result.substring(0, 200)
    }`,
  );
  assertEquals(
    result.includes("Candidate IDs from this search:"),
    true,
    `Payload must include the Candidate IDs line. Got: ${
      result.substring(0, 400)
    }`,
  );
  assertEquals(
    result.includes(`"${newId}"`),
    true,
    `Candidate IDs JSON must include the captured id ${newId}. Got: ${
      result.substring(0, 400)
    }`,
  );
  const separatorIndex = result.indexOf("--- Results ---");
  const firstResultIndex = result.indexOf("--- Result 1 ");
  assertEquals(
    separatorIndex !== -1 && firstResultIndex !== -1 &&
      separatorIndex < firstResultIndex,
    true,
    `'--- Results ---' separator must appear before first '--- Result 1 ...' block. Separator at ${separatorIndex}, first result at ${firstResultIndex}. Got: ${
      result.substring(0, 600)
    }`,
  );
  assertEquals(
    result.includes("Reminder: If any of these thoughts were useful"),
    false,
    `Legacy footer reminder must be absent. Got tail: ${
      result.substring(Math.max(0, result.length - 400))
    }`,
  );
});

Deno.test("search_thoughts payload ends with a trailing usefulness reminder footer", async () => {
  const uniqueContent = `Usefulness footer search marker wombat ${Date.now()}`;
  const newId = await captureAndGetId(uniqueContent, "test-usefulness-footer");
  USEFULNESS_CLEANUP_IDS.push(newId);

  const result = await callTool("search_thoughts", {
    query: uniqueContent,
    limit: 5,
    threshold: 0.3,
  });
  assertExists(result);

  assertEquals(
    result.includes("No thoughts found"),
    false,
    `Expected to find the just-captured thought "${uniqueContent}" but got "No thoughts found".`,
  );

  const reminderPrefix = "⚠️ REQUIRED BEFORE NEXT USER RESPONSE:";
  const firstReminderIndex = result.indexOf(reminderPrefix);
  const lastReminderIndex = result.lastIndexOf(reminderPrefix);
  assertEquals(
    firstReminderIndex !== -1 && lastReminderIndex !== -1 &&
      firstReminderIndex < lastReminderIndex,
    true,
    `Payload must include the reminder in both the header and the footer (distinct positions). First at ${firstReminderIndex}, last at ${lastReminderIndex}. Got: ${
      result.substring(0, 600)
    } ... ${result.substring(Math.max(0, result.length - 400))}`,
  );

  const firstResultIndex = result.indexOf("--- Result 1 ");
  assertEquals(
    firstResultIndex !== -1 && firstResultIndex < lastReminderIndex,
    true,
    `Footer reminder must appear AFTER the results block. First result at ${firstResultIndex}, footer reminder at ${lastReminderIndex}.`,
  );

  const tail = result.substring(lastReminderIndex);
  assertEquals(
    tail.includes(`"${newId}"`),
    true,
    `Footer must include the Candidate IDs JSON with the captured id ${newId}. Got tail: ${tail}`,
  );
});

Deno.test("capture_thought with builds_on bumps prior thoughts and reports credit", async () => {
  const priorA = await captureAndGetId(
    `Usefulness builds_on prior A ${Date.now()}`,
  );
  const priorB = await captureAndGetId(
    `Usefulness builds_on prior B ${Date.now()}`,
  );
  USEFULNESS_CLEANUP_IDS.push(priorA, priorB);

  const baselineA = await getUsefulnessScore(priorA);
  const baselineB = await getUsefulnessScore(priorB);

  const synthContent = `Usefulness builds_on synthesized thought ${Date.now()}`;
  const confirmation = await callTool("capture_thought", {
    content: synthContent,
    author: "test-usefulness-builds-on",
    builds_on: [priorA, priorB],
  });
  assertExists(confirmation);
  assertEquals(
    confirmation.includes("credited 2 prior thought(s) as sources."),
    true,
    `Confirmation should report 2 credited sources. Got: ${confirmation}`,
  );

  const synthId = await lookupThoughtId(synthContent);
  USEFULNESS_CLEANUP_IDS.push(synthId);

  assertEquals(await getUsefulnessScore(priorA), baselineA + 1);
  assertEquals(await getUsefulnessScore(priorB), baselineB + 1);
});

Deno.test("capture_thought without builds_on does not touch other scores", async () => {
  const sentinelId = await captureAndGetId(`Usefulness sentinel ${Date.now()}`);
  USEFULNESS_CLEANUP_IDS.push(sentinelId);
  const baseline = await getUsefulnessScore(sentinelId);

  const neutralContent = `Usefulness no-builds_on neutral ${Date.now()}`;
  const confirmation = await callTool("capture_thought", {
    content: neutralContent,
    author: "test-usefulness-no-builds-on",
  });
  assertExists(confirmation);
  assertEquals(
    confirmation.includes("credited") &&
      confirmation.includes("prior thought(s) as sources."),
    false,
    `Confirmation must NOT include a credited-sources note when builds_on is omitted. Got: ${confirmation}`,
  );

  const neutralId = await lookupThoughtId(neutralContent);
  USEFULNESS_CLEANUP_IDS.push(neutralId);

  assertEquals(
    await getUsefulnessScore(sentinelId),
    baseline,
    "Sentinel score must be unchanged when a different thought is captured without builds_on",
  );
});

Deno.test("capture_thought with builds_on containing unknown UUID still inserts and reports partial credit", async () => {
  const priorId = await captureAndGetId(
    `Usefulness partial prior ${Date.now()}`,
  );
  USEFULNESS_CLEANUP_IDS.push(priorId);
  const unknownId = "11111111-1111-4111-8111-111111111111";
  const baseline = await getUsefulnessScore(priorId);

  const synthContent = `Usefulness partial synth ${Date.now()}`;
  const confirmation = await callTool("capture_thought", {
    content: synthContent,
    author: "test-usefulness-partial",
    builds_on: [priorId, unknownId],
  });
  assertExists(confirmation);
  assertEquals(
    confirmation.includes("credited 1 prior thought(s) as sources."),
    true,
    `Confirmation should report 1 credited source. Got: ${confirmation}`,
  );

  const synthId = await lookupThoughtId(synthContent);
  USEFULNESS_CLEANUP_IDS.push(synthId);

  assertEquals(await getUsefulnessScore(priorId), baseline + 1);
});

Deno.test("capture_thought with empty builds_on array inserts without credit note", async () => {
  const sentinelId = await captureAndGetId(
    `Usefulness empty-builds_on sentinel ${Date.now()}`,
  );
  USEFULNESS_CLEANUP_IDS.push(sentinelId);
  const baseline = await getUsefulnessScore(sentinelId);

  const newContent = `Usefulness empty-builds_on new ${Date.now()}`;
  const confirmation = await callTool("capture_thought", {
    content: newContent,
    author: "test-usefulness-empty-builds-on",
    builds_on: [],
  });
  assertExists(confirmation);
  assertEquals(
    confirmation.includes("credited") &&
      confirmation.includes("prior thought(s) as sources."),
    false,
    `Confirmation must NOT include a credited-sources note for empty builds_on. Got: ${confirmation}`,
  );

  const newId = await lookupThoughtId(newContent);
  USEFULNESS_CLEANUP_IDS.push(newId);

  assertEquals(
    await getUsefulnessScore(sentinelId),
    baseline,
    "Sentinel score must be unchanged when builds_on is empty",
  );
});

Deno.test("list_thoughts payload is wrapped with soft usefulness header and footer", async () => {
  const uniqueContent = `Usefulness list header marker echidna ${Date.now()}`;
  const newId = await captureAndGetId(
    uniqueContent,
    "test-list-usefulness-header",
  );
  USEFULNESS_CLEANUP_IDS.push(newId);

  const result = await callTool("list_thoughts", {
    author: "test-list-usefulness-header",
    limit: 5,
  });
  assertExists(result);

  const softPrefix = "⚠️ BEFORE NEXT USER RESPONSE:";
  const firstIndex = result.indexOf(softPrefix);
  const lastIndex = result.lastIndexOf(softPrefix);
  assertEquals(
    firstIndex !== -1 && lastIndex !== -1 && firstIndex < lastIndex,
    true,
    `list_thoughts payload must include the soft reminder both as header and footer. First at ${firstIndex}, last at ${lastIndex}. Got: ${
      result.substring(0, 600)
    }`,
  );
  assertEquals(
    result.includes("Candidate IDs from this list:"),
    true,
    `list_thoughts payload must include the Candidate IDs line. Got: ${
      result.substring(0, 400)
    }`,
  );
  assertEquals(
    result.includes(`"${newId}"`),
    true,
    `Candidate IDs JSON must include the captured id ${newId}. Got: ${
      result.substring(0, 400)
    }`,
  );
  assertEquals(
    result.includes("--- Results ---"),
    true,
    `list_thoughts payload must include the results separator. Got: ${
      result.substring(0, 400)
    }`,
  );
  assertEquals(
    result.includes("Reminder: If any of these thoughts were useful"),
    false,
    `Legacy footer reminder must be absent. Got tail: ${
      result.substring(Math.max(0, result.length - 400))
    }`,
  );
});

Deno.test("list_thoughts returns plain 'No thoughts found' without reminder when empty", async () => {
  const result = await callTool("list_thoughts", {
    author: `nonexistent-author-${Date.now()}`,
    limit: 5,
  });
  assertExists(result);
  assertEquals(result.includes("No thoughts found"), true);
  assertEquals(
    result.includes("⚠️ BEFORE NEXT USER RESPONSE:"),
    false,
    `Empty list_thoughts response must not include a usefulness reminder. Got: ${result}`,
  );
  assertEquals(
    result.includes("Candidate IDs"),
    false,
    `Empty list_thoughts response must not include a candidate IDs line. Got: ${result}`,
  );
});

Deno.test("get_thought_by_id auto-increments usefulness score by exactly 1", async () => {
  const targetId = await captureAndGetId(
    `Usefulness get-by-id target ${Date.now()}`,
  );
  USEFULNESS_CLEANUP_IDS.push(targetId);
  const baseline = await getUsefulnessScore(targetId);

  const result = await callTool("get_thought_by_id", { id: targetId });
  assertExists(result);
  assertEquals(
    result.includes(`ID: ${targetId}`),
    true,
    `get_thought_by_id should return the thought. Got: ${
      result.substring(0, 300)
    }`,
  );
  assertEquals(
    result.includes("⚠️"),
    false,
    `get_thought_by_id output must not include a usefulness reminder. Got: ${
      result.substring(0, 400)
    }`,
  );

  assertEquals(
    await getUsefulnessScore(targetId),
    baseline + 1,
    "get_thought_by_id should bump usefulness by exactly 1",
  );
});

Deno.test("get_thought_by_id for unknown UUID does not increment any score", async () => {
  const sentinelId = await captureAndGetId(
    `Usefulness get-by-id sentinel ${Date.now()}`,
  );
  USEFULNESS_CLEANUP_IDS.push(sentinelId);
  const baseline = await getUsefulnessScore(sentinelId);

  const unknownId = "22222222-2222-4222-8222-222222222222";
  const result = await callTool("get_thought_by_id", { id: unknownId });
  assertExists(result);
  assertEquals(
    result.includes("No thought found"),
    true,
    `Expected 'No thought found' message for unknown id. Got: ${result}`,
  );

  assertEquals(
    await getUsefulnessScore(sentinelId),
    baseline,
    "Unrelated thought's score must not change when get_thought_by_id misses",
  );
});

Deno.test("cleanup usefulness feedback loop test data", async () => {
  for (const thoughtId of USEFULNESS_CLEANUP_IDS) {
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

// ─── Reconciliation soft-archive (C2) ───────────────────────────────────────
// When ingest_note reconciles and the LLM plan marks a thought for removal,
// that thought MUST be soft-archived (archived_at set), never hard-deleted.
//
// The reconciliation removal decision is made by a live LLM, so we CANNOT force
// the delete branch deterministically here (Step 22's stub will make this exact
// branch deterministic). What we CAN assert without flakiness is the actual C2
// guarantee, which holds for every LLM choice: no original thought row is ever
// hard-deleted by a re-ingest — a thought the plan removes is archived, never
// gone. (Fail-first evidence: against the pre-fix code, when the LLM does choose
// to delete, the row vanishes entirely and this invariant fails.)

const RECONCILE_INGEST_URL =
  "http://localhost:54321/functions/v1/terrestrial-brain-mcp/ingest-note";

async function fetchThoughtsForNote(
  noteId: string,
): Promise<{ id: string; content: string; archived_at: string | null }[]> {
  // Deliberately NO archived_at filter — we want to see archived rows too.
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?reference_id=eq.${
      encodeURIComponent(noteId)
    }&select=id,content,archived_at`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true, "Direct thoughts query should succeed");
  return await response.json();
}

async function ingestNote(
  content: string,
  title: string,
  noteId: string,
): Promise<void> {
  const ingestResponse = await fetch(RECONCILE_INGEST_URL, {
    method: "POST",
    headers: mcpHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ content, title, note_id: noteId }),
  });
  assertEquals(ingestResponse.ok, true, "Ingest request should succeed");
  const result = await ingestResponse.json();
  assertEquals(
    result.success,
    true,
    `Ingest should succeed: ${JSON.stringify(result)}`,
  );
}

Deno.test("ingest_note reconciliation soft-archives removed thoughts (never hard-deletes)", async () => {
  const noteId = `test-reconcile-archive-${Date.now()}`;

  // Initial note: one clear topic → one thought.
  const initialTitle = "Kitchen Maintenance";
  const initialContent = `# Kitchen Maintenance

The office espresso machine in the third-floor kitchen is broken and needs a repair technician scheduled this week.`;

  // Re-ingest: the note is now about a COMPLETELY unrelated topic. The espresso
  // machine no longer appears anywhere, so reconciliation must mark the original
  // thought for removal (its topic is gone). This reliably exercises the delete branch.
  const updatedTitle = "Marketing Plan";
  const updatedContent = `# Marketing Plan

The Q3 marketing campaign will focus on social media advertising and paid influencer partnerships across three regions.`;

  try {
    await ingestNote(initialContent, initialTitle, noteId);
    const afterFirst = await fetchThoughtsForNote(noteId);
    assertEquals(
      afterFirst.length >= 1,
      true,
      `Initial ingest should produce at least one thought. Got ${afterFirst.length}: ${
        JSON.stringify(afterFirst.map((thought) => thought.content))
      }`,
    );
    const initialIds = new Set(afterFirst.map((thought) => thought.id));

    // Re-ingest triggers reconciliation; the old topic is gone → marked for removal.
    await ingestNote(updatedContent, updatedTitle, noteId);

    const afterSecond = await fetchThoughtsForNote(noteId);

    // C2 invariant: every original thought row must still EXIST after
    // reconciliation. If the plan removed it, it is archived (archived_at set),
    // never hard-deleted. This holds for keep/update/delete/add alike.
    for (const originalId of initialIds) {
      const row = afterSecond.find((thought) => thought.id === originalId);
      assertExists(
        row,
        `Original thought ${originalId} must still exist after reconciliation ` +
          `(archived if removed, never hard-deleted). Rows now: ${
            JSON.stringify(afterSecond)
          }`,
      );
    }
  } finally {
    // Self-contained cleanup: hard-delete everything for this test note_id.
    await fetch(
      `${SUPABASE_URL}/rest/v1/thoughts?reference_id=eq.${
        encodeURIComponent(noteId)
      }`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    await fetch(
      `${SUPABASE_URL}/rest/v1/note_snapshots?reference_id=eq.${
        encodeURIComponent(noteId)
      }`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
  }
});
