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

// ─── Ingest Note with Project Detection (via /ingest-note HTTP route) ────────

const CARCHIEF_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
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
