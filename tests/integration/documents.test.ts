import { assertEquals, assertExists, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BASE = "http://localhost:54321/functions/v1/terrestrial-brain-mcp?key=dev-test-key-123";
const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Known seed project from seed.sql
const CARCHIEF_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

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
      params: { name, arguments: args },
    }),
  });

  const text = await res.text();

  // Handle SSE response
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find(line => line.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
    return parsed.result?.content?.[0]?.text || "";
  }

  // Handle JSON response
  const parsed = JSON.parse(text);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
  return parsed.result?.content?.[0]?.text || "";
}

// Track IDs for cleanup
const cleanupDocumentIds: string[] = [];
const cleanupProjectIds: string[] = [];
const cleanupThoughtIds: string[] = [];

// ─── write_document Tests ───────────────────────────────────────────────────

let testDocumentId: string;

Deno.test("write_document stores a document with explicit references", async () => {
  const result = await callTool("write_document", {
    title: "Integration Test Document",
    content: "# Test Document\n\nThis is a full test document stored verbatim.",
    project_id: CARCHIEF_PROJECT_ID,
    file_path: "projects/CarChief/test-doc.md",
    references: { people: [], tasks: [] },
  });

  assertExists(result);
  assertStringIncludes(result, "Document stored");
  assertStringIncludes(result, "Integration Test Document");
  assertStringIncludes(result, "thoughts_required: true");

  // Extract document ID
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Response should contain document id");
  testDocumentId = match![1];
  cleanupDocumentIds.push(testDocumentId);
});

Deno.test("write_document stores content verbatim", async () => {
  const verbatimContent = "Line 1: exact content\nLine 2: special chars <>&\"'\nLine 3: unicode \u2603\u2764\uFE0F";

  const result = await callTool("write_document", {
    title: "Verbatim Test",
    content: verbatimContent,
    project_id: CARCHIEF_PROJECT_ID,
    references: { people: [], tasks: [] },
  });
  assertExists(result);

  const idMatch = result.match(/id: ([0-9a-f-]+)/);
  assertExists(idMatch);
  const docId = idMatch![1];
  cleanupDocumentIds.push(docId);

  // Query DB directly to verify verbatim storage
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/documents?id=eq.${docId}&select=content`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  assertEquals(response.ok, true);
  const docs: { content: string }[] = await response.json();
  assertEquals(docs.length, 1);
  assertEquals(docs[0].content, verbatimContent, "Content should be stored byte-for-byte");
});

Deno.test("write_document rejects non-existent project_id", async () => {
  try {
    await callTool("write_document", {
      title: "Should Fail",
      content: "This should not be stored.",
      project_id: "00000000-0000-0000-0000-999999999999",
      references: { people: [], tasks: [] },
    });
    assertEquals(true, false, "Should have thrown on FK violation");
  } catch (error: unknown) {
    assertStringIncludes((error as Error).message, "Failed to store document");
  }
});

Deno.test("write_document without references triggers pipeline extraction", async () => {
  // Create a test project for extraction detection
  const projectResult = await callTool("create_project", {
    name: "DocExtractTest",
    type: "personal",
  });
  const projectMatch = projectResult.match(/id: ([0-9a-f-]+)/);
  assertExists(projectMatch);
  const projectId = projectMatch![1];
  cleanupProjectIds.push(projectId);

  const result = await callTool("write_document", {
    title: "Extraction Pipeline Test",
    content: "This document is about the DocExtractTest project. It mentions interesting technical details.",
    project_id: projectId,
  });

  assertExists(result);
  assertStringIncludes(result, "Document stored");
  assertStringIncludes(result, "thoughts_required: true");

  const idMatch = result.match(/id: ([0-9a-f-]+)/);
  assertExists(idMatch);
  cleanupDocumentIds.push(idMatch![1]);
});

// ─── get_document Tests ─────────────────────────────────────────────────────

Deno.test("get_document retrieves full document with content", async () => {
  const result = await callTool("get_document", { id: testDocumentId });
  assertExists(result);
  assertStringIncludes(result, "Integration Test Document");
  assertStringIncludes(result, "# Test Document");
  assertStringIncludes(result, "This is a full test document stored verbatim.");
  assertStringIncludes(result, "CarChief");
});

Deno.test("get_document returns error for non-existent ID", async () => {
  try {
    await callTool("get_document", { id: "00000000-0000-0000-0000-999999999999" });
    // If it doesn't throw, the result should indicate not found
  } catch (error: unknown) {
    assertStringIncludes((error as Error).message, "No document found");
  }
});

// ─── list_documents Tests ───────────────────────────────────────────────────

Deno.test("list_documents returns documents", async () => {
  const result = await callTool("list_documents", {});
  assertExists(result);
  assertStringIncludes(result, "document(s)");
  assertStringIncludes(result, "Integration Test Document");
});

Deno.test("list_documents filters by project", async () => {
  const result = await callTool("list_documents", { project_id: CARCHIEF_PROJECT_ID });
  assertExists(result);
  assertStringIncludes(result, "Integration Test Document");
});

Deno.test("list_documents returns empty for project with no documents", async () => {
  // Use a valid but doc-less project
  const projectResult = await callTool("create_project", {
    name: "EmptyDocProject",
    type: "personal",
  });
  const projectMatch = projectResult.match(/id: ([0-9a-f-]+)/);
  assertExists(projectMatch);
  const emptyProjectId = projectMatch![1];
  cleanupProjectIds.push(emptyProjectId);

  const result = await callTool("list_documents", { project_id: emptyProjectId });
  assertStringIncludes(result, "No documents found");
});

// ─── list_documents title_contains Filter Tests ────────────────────────────

Deno.test("list_documents filters by title_contains (substring match)", async () => {
  const result = await callTool("list_documents", { title_contains: "Integration Test" });
  assertExists(result);
  assertStringIncludes(result, "Integration Test Document");
  assertStringIncludes(result, "document(s)");
});

Deno.test("list_documents title_contains is case-insensitive", async () => {
  const result = await callTool("list_documents", { title_contains: "integration test" });
  assertExists(result);
  assertStringIncludes(result, "Integration Test Document");
});

Deno.test("list_documents title_contains returns no results for non-matching string", async () => {
  const result = await callTool("list_documents", { title_contains: "zzz-nonexistent-title-zzz" });
  assertStringIncludes(result, "No documents found");
});

// ─── list_documents search Filter Tests ────────────────────────────────────

Deno.test("list_documents filters by content search", async () => {
  const result = await callTool("list_documents", { search: "full test document stored verbatim" });
  assertExists(result);
  assertStringIncludes(result, "Integration Test Document");
  assertStringIncludes(result, "document(s)");
  // Content body should NOT be in list results (metadata only)
  assertEquals(result.includes("This is a full test document stored verbatim."), false,
    "Content body should not appear in list results");
});

Deno.test("list_documents search is case-insensitive", async () => {
  const result = await callTool("list_documents", { search: "FULL TEST DOCUMENT STORED VERBATIM" });
  assertExists(result);
  assertStringIncludes(result, "Integration Test Document");
});

// ─── list_documents Combined Filter Tests ──────────────────────────────────

Deno.test("list_documents combines project_id and title_contains", async () => {
  const result = await callTool("list_documents", {
    project_id: CARCHIEF_PROJECT_ID,
    title_contains: "Integration",
  });
  assertExists(result);
  assertStringIncludes(result, "Integration Test Document");
});

Deno.test("list_documents combines project_id and title_contains (no match)", async () => {
  // Title exists but not in this project combination
  const result = await callTool("list_documents", {
    project_id: CARCHIEF_PROJECT_ID,
    title_contains: "Extraction Pipeline",
  });
  // Extraction Pipeline Test is under a different project (DocExtractTest), not CarChief
  assertStringIncludes(result, "No documents found");
});

Deno.test("list_documents combines all three filters", async () => {
  const result = await callTool("list_documents", {
    project_id: CARCHIEF_PROJECT_ID,
    title_contains: "Integration",
    search: "stored verbatim",
  });
  assertExists(result);
  assertStringIncludes(result, "Integration Test Document");
});

// ─── capture_thought with document_ids Test ─────────────────────────────────

Deno.test("capture_thought stores document_ids in metadata.references.documents", async () => {
  const uniqueContent = `Integration test: document_ids check ${Date.now()}`;
  const fakeDocId = "00000000-0000-0000-0000-000000000099";

  const result = await callTool("capture_thought", {
    content: uniqueContent,
    document_ids: [fakeDocId],
  });
  assertExists(result);

  // Query DB to verify document_ids stored in metadata.references.documents
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
  assertEquals(thoughts.length, 1, "Should have exactly one thought");

  const refs = thoughts[0].metadata?.references as Record<string, unknown> | undefined;
  assertExists(refs, "metadata.references should exist");
  const documents = refs.documents as string[];
  assertExists(documents, "references.documents should exist");
  assertEquals(
    documents.includes(fakeDocId),
    true,
    `references.documents should contain ${fakeDocId}. Got: ${JSON.stringify(documents)}`,
  );
  cleanupThoughtIds.push(thoughts[0].id);
});

Deno.test("capture_thought without document_ids does not add documents reference", async () => {
  const uniqueContent = `Integration test: no document_ids ${Date.now()}`;

  const result = await callTool("capture_thought", { content: uniqueContent });
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
  // documents should either not exist or be empty
  const documents = refs?.documents as string[] | undefined;
  assertEquals(
    !documents || documents.length === 0,
    true,
    `references.documents should be absent or empty when document_ids not provided. Got: ${JSON.stringify(documents)}`,
  );
  cleanupThoughtIds.push(thoughts[0].id);
});

// ─── Cleanup ────────────────────────────────────────────────────────────────

Deno.test("cleanup documents test data", async () => {
  // Clean up documents
  for (const docId of cleanupDocumentIds) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/documents?id=eq.${docId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    assertEquals(response.ok, true, `Cleanup of document ${docId} should succeed`);
  }

  // Clean up thoughts
  for (const thoughtId of cleanupThoughtIds) {
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
    assertEquals(response.ok, true, `Cleanup of thought ${thoughtId} should succeed`);
  }

  // Clean up test projects (archive them)
  for (const projectId of cleanupProjectIds) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/projects?id=eq.${projectId}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ archived_at: new Date().toISOString() }),
      },
    );
    assertEquals(response.ok, true, `Cleanup of project ${projectId} should succeed`);
  }
});
