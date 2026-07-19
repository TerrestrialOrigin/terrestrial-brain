// Integration coverage for write_document / get_document / list_documents /
// update_document. Every test owns its fixtures (TEST-9/10): unique names via
// uniqueName(), cleanup in try/finally with ids registered BEFORE assertions,
// hard-deletes (never archive-as-cleanup), and no test reads state created by
// an earlier test.

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  callTool,
  callToolRaw,
  listTools,
  restUrl,
  serviceHeaders,
  uniqueName,
  uniqueToken,
} from "../helpers/mcp-client.ts";

// Known seed project from seed.sql — seed data, not a fixture; never deleted.
const TEST_PROJ_ID = "00000000-0000-0000-0000-000000000001";

/** Extracts the `id: <uuid>` from a tool confirmation. */
function extractId(result: string): string {
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, `Response should contain an id. Got: ${result}`);
  return match![1];
}

/**
 * Per-test fixture tracker: register ids as soon as they exist (before any
 * assertion), then `cleanup()` in `finally` hard-deletes everything — even
 * when the test body fails (TEST-9/16).
 */
function makeFixtures() {
  const documentIds: string[] = [];
  const thoughtIds: string[] = [];
  const projectIds: string[] = [];
  const taskIds: string[] = [];

  async function deleteRows(table: string, ids: string[]): Promise<void> {
    for (const rowId of ids) {
      const response = await fetch(restUrl(`${table}?id=eq.${rowId}`), {
        method: "DELETE",
        headers: serviceHeaders(),
      });
      await response.body?.cancel();
    }
  }

  return {
    documentIds,
    thoughtIds,
    projectIds,
    taskIds,
    async cleanup(): Promise<void> {
      // Order matters for FKs: dependents before projects.
      await deleteRows("documents", documentIds);
      await deleteRows("thoughts", thoughtIds);
      await deleteRows("tasks", taskIds);
      await deleteRows("projects", projectIds);
    },
  };
}

/** Creates a project fixture and registers it for cleanup. */
async function createProjectFixture(
  fixtures: ReturnType<typeof makeFixtures>,
  namePrefix: string,
): Promise<string> {
  const result = await callTool("create_project", {
    name: uniqueName(namePrefix),
    type: "personal",
  });
  const projectId = extractId(result);
  fixtures.projectIds.push(projectId);
  return projectId;
}

/** Creates a document fixture and registers it for cleanup. */
async function createDocumentFixture(
  fixtures: ReturnType<typeof makeFixtures>,
  options: {
    title: string;
    content: string;
    projectId?: string;
    filePath?: string;
    withExplicitEmptyReferences?: boolean;
  },
): Promise<string> {
  const result = await callTool("write_document", {
    title: options.title,
    content: options.content,
    project_id: options.projectId ?? TEST_PROJ_ID,
    ...(options.filePath ? { file_path: options.filePath } : {}),
    ...(options.withExplicitEmptyReferences === false
      ? {}
      : { references: { people: [], tasks: [] } }),
  });
  const documentId = extractId(result);
  fixtures.documentIds.push(documentId);
  return documentId;
}

/** Fetches selected columns of one row via PostgREST. */
async function fetchRow<RowShape>(
  table: string,
  rowId: string,
  select: string,
): Promise<RowShape[]> {
  const response = await fetch(
    restUrl(`${table}?id=eq.${rowId}&select=${select}`),
    { headers: serviceHeaders() },
  );
  assertEquals(response.ok, true);
  return await response.json();
}

// ─── write_document Tests ───────────────────────────────────────────────────

Deno.test("write_document stores a document with explicit references", async () => {
  const fixtures = makeFixtures();
  try {
    const title = uniqueName("Integration Test Document");
    const result = await callTool("write_document", {
      title,
      content:
        "# Test Document\n\nThis is a full test document stored verbatim.",
      project_id: TEST_PROJ_ID,
      file_path: "projects/Test Proj/test-doc.md",
      references: { people: [], tasks: [] },
    });
    fixtures.documentIds.push(extractId(result));

    assertStringIncludes(result, "Document stored");
    assertStringIncludes(result, title);
    assertStringIncludes(result, "thoughts_required: true");
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("write_document stores content verbatim", async () => {
  const fixtures = makeFixtures();
  try {
    const verbatimContent =
      "Line 1: exact content\nLine 2: special chars <>&\"'\nLine 3: unicode ☃❤️";
    const documentId = await createDocumentFixture(fixtures, {
      title: uniqueName("Verbatim Test"),
      content: verbatimContent,
    });

    const docs = await fetchRow<{ content: string }>(
      "documents",
      documentId,
      "content",
    );
    assertEquals(docs.length, 1);
    assertEquals(
      docs[0].content,
      verbatimContent,
      "Content should be stored byte-for-byte",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("write_document rejects non-existent project_id", async () => {
  const { text, isError } = await callToolRaw("write_document", {
    title: uniqueName("Should Fail"),
    content: "This should not be stored.",
    project_id: "00000000-0000-0000-0000-999999999999",
    references: { people: [], tasks: [] },
  });
  assertEquals(isError, true, "FK violation must surface as a tool error");
  assertStringIncludes(text, "Failed to store document");
});

Deno.test("write_document without references triggers pipeline extraction", async () => {
  const fixtures = makeFixtures();
  try {
    const projectId = await createProjectFixture(fixtures, "DocExtractTest");
    const title = uniqueName("Extraction Pipeline Test");
    const result = await callTool("write_document", {
      title,
      content:
        "This document mentions interesting technical details for extraction.",
      project_id: projectId,
    });
    fixtures.documentIds.push(extractId(result));

    assertStringIncludes(result, "Document stored");
    assertStringIncludes(result, "thoughts_required: true");
  } finally {
    await fixtures.cleanup();
  }
});

// ─── get_document Tests ─────────────────────────────────────────────────────

Deno.test("get_document retrieves full document with content", async () => {
  const fixtures = makeFixtures();
  try {
    const title = uniqueName("Get Document Test");
    const documentId = await createDocumentFixture(fixtures, {
      title,
      content:
        "# Test Document\n\nThis is a full test document stored verbatim.",
    });

    const result = await callTool("get_document", { id: documentId });
    assertStringIncludes(result, title);
    assertStringIncludes(result, "# Test Document");
    assertStringIncludes(
      result,
      "This is a full test document stored verbatim.",
    );
    assertStringIncludes(result, "Test Proj");
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("get_document reports not-found for a non-existent ID", async () => {
  // TEST-7: one deterministic, always-asserted path — never a try/catch whose
  // only assertion lives in the catch. get_document's not-found convention is a
  // non-error result with the exact not-found text (PGRST116 → textResult).
  const { text, isError } = await callToolRaw("get_document", {
    id: "00000000-0000-0000-0000-999999999999",
  });
  assertEquals(isError, false, "not-found is a non-error result by convention");
  assertStringIncludes(
    text,
    'No document found with ID "00000000-0000-0000-0000-999999999999"',
  );
});

// ─── list_documents Tests ───────────────────────────────────────────────────

Deno.test("list_documents returns documents", async () => {
  const fixtures = makeFixtures();
  try {
    const title = uniqueName("List Documents Test");
    await createDocumentFixture(fixtures, {
      title,
      content: "List test content.",
    });

    const result = await callTool("list_documents", {});
    assertStringIncludes(result, "document(s)");
    assertStringIncludes(result, title);
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("list_documents filters by project", async () => {
  const fixtures = makeFixtures();
  try {
    const projectId = await createProjectFixture(fixtures, "ListFilterProject");
    const inProjectTitle = uniqueName("In Filter Project");
    await createDocumentFixture(fixtures, {
      title: inProjectTitle,
      content: "Belongs to the filter project.",
      projectId,
    });
    const otherTitle = uniqueName("Other Project Doc");
    await createDocumentFixture(fixtures, {
      title: otherTitle,
      content: "Belongs to the seed project.",
    });

    const result = await callTool("list_documents", { project_id: projectId });
    assertStringIncludes(result, inProjectTitle);
    assertEquals(
      result.includes(otherTitle),
      false,
      "A document in another project must not match the project filter",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("list_documents returns empty for project with no documents", async () => {
  const fixtures = makeFixtures();
  try {
    const emptyProjectId = await createProjectFixture(
      fixtures,
      "EmptyDocProject",
    );
    const result = await callTool("list_documents", {
      project_id: emptyProjectId,
    });
    assertStringIncludes(result, "No documents found");
  } finally {
    await fixtures.cleanup();
  }
});

// ─── list_documents title_contains Filter Tests ────────────────────────────

Deno.test("list_documents filters by title_contains (substring match)", async () => {
  const fixtures = makeFixtures();
  try {
    const marker = `TitleContains-${uniqueToken()}`;
    const title = `Document ${marker}`;
    await createDocumentFixture(fixtures, {
      title,
      content: "Title filter content.",
    });

    const result = await callTool("list_documents", {
      title_contains: marker,
    });
    assertStringIncludes(result, title);
    assertStringIncludes(result, "document(s)");
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("list_documents title_contains is case-insensitive", async () => {
  const fixtures = makeFixtures();
  try {
    const marker = `CaseCheck-${uniqueToken()}`;
    const title = `Document ${marker}`;
    await createDocumentFixture(fixtures, {
      title,
      content: "Case-insensitivity content.",
    });

    const result = await callTool("list_documents", {
      title_contains: marker.toLowerCase(),
    });
    assertStringIncludes(result, title);
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("list_documents title_contains returns no results for non-matching string", async () => {
  const result = await callTool("list_documents", {
    title_contains: `zzz-nonexistent-${uniqueToken()}-zzz`,
  });
  assertStringIncludes(result, "No documents found");
});

// ─── list_documents search Filter Tests ────────────────────────────────────

Deno.test("list_documents filters by content search", async () => {
  const fixtures = makeFixtures();
  try {
    const contentMarker = `content-search-${uniqueToken()}`;
    const title = uniqueName("Content Search Test");
    await createDocumentFixture(fixtures, {
      title,
      content: `Body mentioning ${contentMarker} exactly once.`,
    });

    const result = await callTool("list_documents", { search: contentMarker });
    assertStringIncludes(result, title);
    assertStringIncludes(result, "document(s)");
    // Content body should NOT be in list results (metadata only)
    assertEquals(
      result.includes(`Body mentioning ${contentMarker}`),
      false,
      "Content body should not appear in list results",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("list_documents search is case-insensitive", async () => {
  const fixtures = makeFixtures();
  try {
    const contentMarker = `casesearch-${uniqueToken()}`;
    const title = uniqueName("Case Search Test");
    await createDocumentFixture(fixtures, {
      title,
      content: `Body mentioning ${contentMarker} exactly once.`,
    });

    const result = await callTool("list_documents", {
      search: contentMarker.toUpperCase(),
    });
    assertStringIncludes(result, title);
  } finally {
    await fixtures.cleanup();
  }
});

// ─── list_documents Combined Filter Tests ──────────────────────────────────

Deno.test("list_documents combines project_id and title_contains", async () => {
  const fixtures = makeFixtures();
  try {
    const marker = `Combined-${uniqueToken()}`;
    const title = `Document ${marker}`;
    await createDocumentFixture(fixtures, {
      title,
      content: "Combined filter content.",
    });

    const result = await callTool("list_documents", {
      project_id: TEST_PROJ_ID,
      title_contains: marker,
    });
    assertStringIncludes(result, title);
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("list_documents combines project_id and title_contains (no match)", async () => {
  const fixtures = makeFixtures();
  try {
    // The title exists — but under a different project than the filter asks for.
    const otherProjectId = await createProjectFixture(
      fixtures,
      "CombinedNoMatch",
    );
    const marker = `Elsewhere-${uniqueToken()}`;
    await createDocumentFixture(fixtures, {
      title: `Document ${marker}`,
      content: "Lives under the other project.",
      projectId: otherProjectId,
    });

    const result = await callTool("list_documents", {
      project_id: TEST_PROJ_ID,
      title_contains: marker,
    });
    assertStringIncludes(result, "No documents found");
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("list_documents combines all three filters", async () => {
  const fixtures = makeFixtures();
  try {
    const marker = `AllFilters-${uniqueToken()}`;
    const contentMarker = `allfilters-body-${uniqueToken()}`;
    const title = `Document ${marker}`;
    await createDocumentFixture(fixtures, {
      title,
      content: `Body mentioning ${contentMarker} exactly once.`,
    });

    const result = await callTool("list_documents", {
      project_id: TEST_PROJ_ID,
      title_contains: marker,
      search: contentMarker,
    });
    assertStringIncludes(result, title);
  } finally {
    await fixtures.cleanup();
  }
});

// ─── capture_thought with document_ids Test ─────────────────────────────────

Deno.test("capture_thought stores document_ids in metadata.references.documents", async () => {
  const fixtures = makeFixtures();
  try {
    const uniqueContent =
      `Integration test: document_ids check ${uniqueToken()}`;
    const fakeDocId = "00000000-0000-0000-0000-000000000099";

    const result = await callTool("capture_thought", {
      content: uniqueContent,
      document_ids: [fakeDocId],
    });
    assertExists(result);

    const response = await fetch(
      restUrl(
        `thoughts?content=eq.${
          encodeURIComponent(uniqueContent)
        }&select=id,metadata`,
      ),
      { headers: serviceHeaders() },
    );
    assertEquals(response.ok, true);
    const thoughts: { id: string; metadata: Record<string, unknown> }[] =
      await response.json();
    assertEquals(thoughts.length, 1, "Should have exactly one thought");
    fixtures.thoughtIds.push(thoughts[0].id);

    const refs = thoughts[0].metadata?.references as
      | Record<string, unknown>
      | undefined;
    assertExists(refs, "metadata.references should exist");
    const documents = refs.documents as string[];
    assertExists(documents, "references.documents should exist");
    assertEquals(
      documents.includes(fakeDocId),
      true,
      `references.documents should contain ${fakeDocId}. Got: ${
        JSON.stringify(documents)
      }`,
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("capture_thought without document_ids does not add documents reference", async () => {
  const fixtures = makeFixtures();
  try {
    const uniqueContent = `Integration test: no document_ids ${uniqueToken()}`;
    const result = await callTool("capture_thought", {
      content: uniqueContent,
    });
    assertExists(result);

    const response = await fetch(
      restUrl(
        `thoughts?content=eq.${
          encodeURIComponent(uniqueContent)
        }&select=id,metadata`,
      ),
      { headers: serviceHeaders() },
    );
    assertEquals(response.ok, true);
    const thoughts: { id: string; metadata: Record<string, unknown> }[] =
      await response.json();
    assertEquals(thoughts.length, 1);
    fixtures.thoughtIds.push(thoughts[0].id);

    const refs = thoughts[0].metadata?.references as
      | Record<string, unknown>
      | undefined;
    const documents = refs?.documents as string[] | undefined;
    assertEquals(
      !documents || documents.length === 0,
      true,
      `references.documents should be absent or empty when document_ids not provided. Got: ${
        JSON.stringify(documents)
      }`,
    );
  } finally {
    await fixtures.cleanup();
  }
});

// ─── update_document Tests ─────────────────────────────────────────────────

Deno.test("update_document updates title only (no thought churn)", async () => {
  const fixtures = makeFixtures();
  try {
    const documentId = await createDocumentFixture(fixtures, {
      title: uniqueName("Update Title Test"),
      content: "Content that should remain unchanged.",
    });

    const beforeDocs = await fetchRow<{ updated_at: string }>(
      "documents",
      documentId,
      "updated_at",
    );
    const originalUpdatedAt = beforeDocs[0].updated_at;

    // No fixed sleep (TEST-15): the update runs in a later transaction, so the
    // trigger-maintained microsecond-precision updated_at differs on its own.
    const newTitle = uniqueName("Updated Title Test");
    const result = await callTool("update_document", {
      id: documentId,
      title: newTitle,
    });

    assertStringIncludes(result, "Document updated");
    assertStringIncludes(result, "title");
    assertEquals(
      result.includes("thoughts_required"),
      false,
      "Title-only update should not trigger thoughts_required",
    );

    const afterDocs = await fetchRow<
      { title: string; content: string; updated_at: string }
    >("documents", documentId, "title,content,updated_at");
    assertEquals(afterDocs[0].title, newTitle);
    assertEquals(afterDocs[0].content, "Content that should remain unchanged.");
    assertEquals(
      afterDocs[0].updated_at !== originalUpdatedAt,
      true,
      "updated_at should have refreshed",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("update_document updates content — archives old thoughts, re-extracts refs, returns thoughts_required", async () => {
  const fixtures = makeFixtures();
  try {
    const documentId = await createDocumentFixture(fixtures, {
      title: uniqueName("Content Update Test"),
      content: "Original content for testing updates.",
    });

    const thoughtContent = `Thought linked to doc ${uniqueToken()}`;
    await callTool("capture_thought", {
      content: thoughtContent,
      document_ids: [documentId],
    });
    const thoughtResp = await fetch(
      restUrl(
        `thoughts?content=eq.${encodeURIComponent(thoughtContent)}&select=id`,
      ),
      { headers: serviceHeaders() },
    );
    const thoughts: { id: string }[] = await thoughtResp.json();
    assertEquals(
      thoughts.length,
      1,
      "Should have the linked thought before update",
    );
    const thoughtId = thoughts[0].id;
    fixtures.thoughtIds.push(thoughtId);

    const newContent = "Completely new content after update.";
    const updateResult = await callTool("update_document", {
      id: documentId,
      content: newContent,
    });

    assertStringIncludes(updateResult, "Document updated");
    assertStringIncludes(updateResult, "thoughts_required: true");

    // Old thought soft-archived (NOT hard-deleted): row still exists with
    // archived_at set.
    const archivedThoughts = await fetchRow<
      { id: string; archived_at: string | null }
    >("thoughts", thoughtId, "id,archived_at");
    assertEquals(
      archivedThoughts.length,
      1,
      "Linked thought should still exist (archived, not deleted) after content update",
    );
    assertExists(
      archivedThoughts[0].archived_at,
      "Linked thought should have archived_at set after content update",
    );

    const docs = await fetchRow<{ content: string }>(
      "documents",
      documentId,
      "content",
    );
    assertEquals(docs[0].content, newContent, "Content updated verbatim");
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("update_document with a failing document update leaves linked thoughts untouched (C3 ordering)", async () => {
  const fixtures = makeFixtures();
  try {
    const documentId = await createDocumentFixture(fixtures, {
      title: uniqueName("Ordering Failure Test"),
      content: "Original content for the ordering-failure test.",
    });

    const thoughtContent = `Ordering-failure linked thought ${uniqueToken()}`;
    await callTool("capture_thought", {
      content: thoughtContent,
      document_ids: [documentId],
    });
    const thoughtResp = await fetch(
      restUrl(
        `thoughts?content=eq.${
          encodeURIComponent(thoughtContent)
        }&select=id,archived_at`,
      ),
      { headers: serviceHeaders() },
    );
    const linked: { id: string; archived_at: string | null }[] =
      await thoughtResp.json();
    assertEquals(
      linked.length,
      1,
      "Should have the linked thought before the failing update",
    );
    const thoughtId = linked[0].id;
    fixtures.thoughtIds.push(thoughtId);

    // Update with new content AND an invalid project_id (FK violation). The
    // document UPDATE must fail — and because thought cleanup runs only AFTER a
    // successful update, the linked thought must remain untouched (active).
    const { isError } = await callToolRaw("update_document", {
      id: documentId,
      content:
        "New content that should never persist because the update fails.",
      project_id: "00000000-0000-0000-0000-0000000000ff",
    });
    assertEquals(
      isError,
      true,
      "update_document should error on an invalid project_id (FK violation)",
    );

    const after = await fetchRow<{ id: string; archived_at: string | null }>(
      "thoughts",
      thoughtId,
      "id,archived_at",
    );
    assertEquals(
      after.length,
      1,
      "Linked thought must still exist after a failed document update",
    );
    assertEquals(
      after[0].archived_at,
      null,
      "Linked thought must remain active (not archived/deleted) when the document update fails",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("update_document updates project_id only", async () => {
  const fixtures = makeFixtures();
  try {
    const newProjectId = await createProjectFixture(
      fixtures,
      "UpdateDocTargetProject",
    );
    const documentId = await createDocumentFixture(fixtures, {
      title: uniqueName("Project Reassign Test"),
      content: "Document to be reassigned.",
    });

    const result = await callTool("update_document", {
      id: documentId,
      project_id: newProjectId,
    });
    assertStringIncludes(result, "Document updated");
    assertStringIncludes(result, "project_id");

    const docs = await fetchRow<{ project_id: string }>(
      "documents",
      documentId,
      "project_id",
    );
    assertEquals(docs[0].project_id, newProjectId, "project_id updated");
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("update_document returns error when no optional fields provided", async () => {
  const fixtures = makeFixtures();
  try {
    const documentId = await createDocumentFixture(fixtures, {
      title: uniqueName("No Fields Test"),
      content: "Document for the no-fields validation test.",
    });

    const { text, isError } = await callToolRaw("update_document", {
      id: documentId,
    });
    assertEquals(isError, true, "must reject an update with no fields");
    assertStringIncludes(
      text,
      "At least one of title, content, or project_id must be provided",
    );
  } finally {
    await fixtures.cleanup();
  }
});

Deno.test("update_document returns error for non-existent document ID", async () => {
  const { text, isError } = await callToolRaw("update_document", {
    id: "00000000-0000-0000-0000-999999999999",
    title: "Should Fail",
  });
  assertEquals(isError, true, "must reject an unknown document id");
  assertStringIncludes(text, "Document not found");
});

Deno.test("write_document description mentions update_document", async () => {
  const tools = await listTools();
  const writeDoc = tools.find((tool) => tool.name === "write_document");
  assertExists(writeDoc, "write_document tool should exist");
  assertStringIncludes(
    writeDoc!.description,
    "update_document",
    "write_document description should mention update_document",
  );
});
