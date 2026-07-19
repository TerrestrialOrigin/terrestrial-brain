import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  callTool,
  callToolRaw,
  restUrl,
  serviceHeaders,
  uniqueName,
  uniqueToken,
} from "../helpers/mcp-client.ts";

// Seed data IDs from supabase/seed.sql
const TEST_PROJ_ID = "00000000-0000-0000-0000-000000000001";
const TERRESTRIAL_BRAIN_ID = "00000000-0000-0000-0000-000000000002";
const TEST_PROJ_BACKEND_ID = "00000000-0000-0000-0000-000000000003";

// ─── Fixture hygiene helpers (TEST-10/TEST-16) ─────────────────────────────
// Every fixture name/content embeds a uniqueName()/uniqueToken() marker, and
// each test HARD-deletes its own rows by that marker in `finally` — no shared
// cleanup arrays, no trailing cleanup-as-a-test, no archive-as-cleanup.

async function deleteRowsWhere(table: string, filter: string): Promise<void> {
  const response = await fetch(restUrl(`${table}?${filter}`), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  await response.body?.cancel();
}

function deleteThoughtsByContent(content: string): Promise<void> {
  return deleteRowsWhere(
    "thoughts",
    `content=eq.${encodeURIComponent(content)}`,
  );
}

function deleteTasksByContent(content: string): Promise<void> {
  return deleteRowsWhere("tasks", `content=eq.${encodeURIComponent(content)}`);
}

function deleteProjectsByName(name: string): Promise<void> {
  return deleteRowsWhere("projects", `name=eq.${encodeURIComponent(name)}`);
}

function deletePeopleByName(name: string): Promise<void> {
  return deleteRowsWhere("people", `name=eq.${encodeURIComponent(name)}`);
}

async function fetchThoughtIdByContent(content: string): Promise<string> {
  const response = await fetch(
    restUrl(`thoughts?content=eq.${encodeURIComponent(content)}&select=id`),
    { headers: serviceHeaders() },
  );
  const thoughts: { id: string }[] = await response.json();
  assertEquals(thoughts.length, 1);
  return thoughts[0].id;
}

// ─── get_project_summary Tests ─────────────────────────────────────────────

Deno.test("get_project_summary returns project details for seed project", async () => {
  const result = await callTool("get_project_summary", { id: TEST_PROJ_ID });
  assertExists(result);
  assertStringIncludes(result, "Test Proj");
  assertStringIncludes(result, "client");
  assertStringIncludes(result, "Main client project");
});

Deno.test("get_project_summary shows child projects", async () => {
  const result = await callTool("get_project_summary", { id: TEST_PROJ_ID });
  assertStringIncludes(result, "Child Projects");
  assertStringIncludes(result, "Test Proj Backend");
});

Deno.test("get_project_summary shows parent project", async () => {
  const result = await callTool("get_project_summary", {
    id: TEST_PROJ_BACKEND_ID,
  });
  assertStringIncludes(result, "Parent:");
  assertStringIncludes(result, "Test Proj");
});

Deno.test("get_project_summary shows open tasks for Terrestrial Brain", async () => {
  // Seed data has 2 open tasks and 1 done task for Terrestrial Brain
  const result = await callTool("get_project_summary", {
    id: TERRESTRIAL_BRAIN_ID,
  });
  assertStringIncludes(result, "Open Tasks");
  assertStringIncludes(result, "Write migration files for new tables");
  assertStringIncludes(result, "Refactor edge function into modules");
});

Deno.test("get_project_summary shows thoughts with old-format references (project_id)", async () => {
  // Seed thought: "Test Proj Backend needs response caching..." has references.project_id = TEST_PROJ_ID
  const result = await callTool("get_project_summary", { id: TEST_PROJ_ID });
  assertStringIncludes(result, "Recent Thoughts");
  assertStringIncludes(result, "response caching");
});

Deno.test("get_project_summary returns error for non-existent project", async () => {
  const result = await callToolRaw("get_project_summary", {
    id: "00000000-0000-0000-0000-999999999999",
  });
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "Project not found");
});

Deno.test("get_project_summary handles project with no tasks or thoughts", async () => {
  // Create a temporary empty project with a unique name (TEST-10) and
  // hard-delete it in finally (TEST-16 — archive-as-cleanup accumulated rows).
  const emptyProjectName = uniqueName("Empty Test Project");
  try {
    const createResult = await callTool("create_project", {
      name: emptyProjectName,
      type: "personal",
      description: "Has no tasks or thoughts",
    });
    const match = createResult.match(/id: ([0-9a-f-]+)/);
    assertExists(match);
    const emptyProjectId = match![1];

    const result = await callTool("get_project_summary", {
      id: emptyProjectId,
    });
    assertStringIncludes(result, emptyProjectName);
    assertStringIncludes(result, "No open tasks");
    assertStringIncludes(result, "No recent thoughts");
    // Empty-vs-broken (finding C9): a genuinely-empty section renders empty-state
    // prose, NOT the "(section unavailable: …)" marker reserved for query errors.
    assertEquals(
      result.includes("section unavailable"),
      false,
      `genuine-empty summary must not show the unavailable marker. Got: ${
        result.substring(0, 800)
      }`,
    );
  } finally {
    await deleteProjectsByName(emptyProjectName);
  }
});

// ─── get_recent_activity Tests ─────────────────────────────────────────────

Deno.test("get_recent_activity returns activity within default window", async () => {
  const result = await callTool("get_recent_activity", {});
  assertExists(result);
  assertStringIncludes(result, "Activity");
  // Should have section headers
  assertStringIncludes(result, "Thoughts");
  assertStringIncludes(result, "Tasks Created");
  assertStringIncludes(result, "Tasks Completed");
  assertStringIncludes(result, "Projects");
});

Deno.test("get_recent_activity shows seed data (created today)", async () => {
  // Seed data was inserted when emulators started, so it's within 1-day window
  const result = await callTool("get_recent_activity", { days: 1 });
  // Seed projects should appear
  assertStringIncludes(result, "Test Proj");
  // Seed tasks should appear
  assertStringIncludes(result, "Tasks Created");
});

Deno.test("get_recent_activity with large window includes all data", async () => {
  const result = await callTool("get_recent_activity", { days: 365 });
  assertExists(result);
  assertStringIncludes(result, "Activity — Last 365 Days");
});

Deno.test("get_recent_activity clamps negative days to 1", async () => {
  const result = await callTool("get_recent_activity", { days: -5 });
  assertExists(result);
  assertStringIncludes(result, "Activity — Last 1 Day");
});

Deno.test("get_recent_activity clamps zero days to 1", async () => {
  const result = await callTool("get_recent_activity", { days: 0 });
  assertExists(result);
  assertStringIncludes(result, "Activity — Last 1 Day");
});

// TOOL-10 — a huge window is clamped to the upper bound (366), not rejected, so
// it cannot defeat the per-section caps by widening `since`.
Deno.test("get_recent_activity clamps an oversized window to 366 days", async () => {
  const result = await callTool("get_recent_activity", { days: 100000 });
  assertExists(result);
  assertStringIncludes(result, "Activity — Last 366 Days");
});

Deno.test("get_recent_activity shows tasks with project names", async () => {
  // Create a fresh task linked to Terrestrial Brain so it always appears in the
  // 1-day window; hard-delete it in finally (was previously leaked — TEST-16).
  const taskContent = uniqueName("recent-activity-project-name-test");
  try {
    await callTool("create_task", {
      content: taskContent,
      project_id: TERRESTRIAL_BRAIN_ID,
    });

    const result = await callTool("get_recent_activity", { days: 1 });
    assertStringIncludes(result, "Terrestrial Brain");
  } finally {
    await deleteTasksByContent(taskContent);
  }
});

// ─── Archived record exclusion tests ──────────────────────────────────────

Deno.test("get_recent_activity excludes archived thoughts", async () => {
  // Capture a thought, archive it, then verify it doesn't appear in recent activity
  const uniqueContent = uniqueName("Archived activity exclusion test");
  try {
    await callTool("capture_thought", {
      content: uniqueContent,
      author: "test-archived-activity",
    });

    const thoughtId = await fetchThoughtIdByContent(uniqueContent);

    // Archive it
    await callTool("archive_thought", { id: thoughtId });

    // Check get_recent_activity
    const result = await callTool("get_recent_activity", { days: 1 });
    assertEquals(
      result.includes(uniqueContent),
      false,
      `Archived thought should not appear in get_recent_activity. Got: ${
        result.substring(0, 500)
      }`,
    );
  } finally {
    await deleteThoughtsByContent(uniqueContent);
  }
});

Deno.test("get_recent_activity excludes archived tasks", async () => {
  // Create a task, archive it, verify exclusion
  const taskContent = uniqueName("Archived task activity test");
  try {
    const createResult = await callTool("create_task", {
      content: taskContent,
      project_id: TERRESTRIAL_BRAIN_ID,
    });
    const taskMatch = createResult.match(/ID: ([0-9a-f-]+)/i) ||
      createResult.match(/id: ([0-9a-f-]+)/i);
    assertExists(taskMatch, `Should have created a task. Got: ${createResult}`);
    const taskId = taskMatch![1];

    // Archive it
    await callTool("archive_task", { id: taskId });

    const result = await callTool("get_recent_activity", { days: 1 });
    assertEquals(
      result.includes(taskContent),
      false,
      `Archived task should not appear in get_recent_activity. Got: ${
        result.substring(0, 800)
      }`,
    );
  } finally {
    await deleteTasksByContent(taskContent);
  }
});

Deno.test("get_recent_activity excludes archived projects", async () => {
  const projectName = uniqueName("Archived project activity test");
  try {
    const createResult = await callTool("create_project", {
      name: projectName,
      type: "personal",
    });
    const projectMatch = createResult.match(/id: ([0-9a-f-]+)/);
    assertExists(
      projectMatch,
      `Should have created a project. Got: ${createResult}`,
    );
    const projectId = projectMatch![1];

    // Archive it
    await callTool("archive_project", { id: projectId });

    const result = await callTool("get_recent_activity", { days: 1 });
    assertEquals(
      result.includes(projectName),
      false,
      `Archived project should not appear in get_recent_activity. Got: ${
        result.substring(0, 800)
      }`,
    );
  } finally {
    await deleteProjectsByName(projectName);
  }
});

Deno.test("get_recent_activity excludes archived people", async () => {
  const personName = uniqueName("Archived person activity test");
  try {
    const createResult = await callTool("create_person", {
      name: personName,
      type: "human",
    });
    const personMatch = createResult.match(/id: ([0-9a-f-]+)/i) ||
      createResult.match(/ID: ([0-9a-f-]+)/i);
    assertExists(
      personMatch,
      `Should have created a person. Got: ${createResult}`,
    );
    const personId = personMatch![1];

    // Archive it
    await callTool("archive_person", { id: personId });

    const result = await callTool("get_recent_activity", { days: 1 });
    assertEquals(
      result.includes(personName),
      false,
      `Archived person should not appear in get_recent_activity. Got: ${
        result.substring(0, 800)
      }`,
    );
  } finally {
    await deletePeopleByName(personName);
  }
});

Deno.test("get_project_summary excludes archived thoughts", async () => {
  // Capture a thought linked to TB project, archive it, verify it's excluded from summary
  const uniqueContent = uniqueName("Archived summary exclusion test");
  try {
    await callTool("capture_thought", {
      content: uniqueContent,
      author: "test-archived-summary",
      project_ids: [TERRESTRIAL_BRAIN_ID],
    });

    const thoughtId = await fetchThoughtIdByContent(uniqueContent);

    // Archive it
    await callTool("archive_thought", { id: thoughtId });

    const result = await callTool("get_project_summary", {
      id: TERRESTRIAL_BRAIN_ID,
    });
    assertEquals(
      result.includes(uniqueContent),
      false,
      `Archived thought should not appear in get_project_summary. Got: ${
        result.substring(0, 800)
      }`,
    );
  } finally {
    await deleteThoughtsByContent(uniqueContent);
  }
});

// ─── get_note_snapshot Tests ──────────────────────────────────────────────

async function createNoteSnapshot(
  overrides: Partial<{ reference_id: string; title: string; content: string }> =
    {},
): Promise<
  { id: string; reference_id: string; title: string; content: string }
> {
  const marker = uniqueToken();
  const payload = {
    reference_id: overrides.reference_id ?? `test-snapshot-${marker}.md`,
    title: overrides.title ?? `Test Snapshot ${marker}`,
    content: overrides.content ??
      `# Test Note\n\nBody content for snapshot test ${marker}.`,
    source: "obsidian",
  };
  const response = await fetch(restUrl("note_snapshots"), {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to seed note_snapshot: ${response.status} ${await response
        .text()}`,
    );
  }
  const rows: {
    id: string;
    reference_id: string;
    title: string;
    content: string;
  }[] = await response.json();
  return rows[0];
}

function deleteNoteSnapshotById(id: string): Promise<void> {
  return deleteRowsWhere("note_snapshots", `id=eq.${id}`);
}

Deno.test("get_note_snapshot fetches by id", async () => {
  const snapshot = await createNoteSnapshot();
  try {
    const result = await callTool("get_note_snapshot", { id: snapshot.id });
    assertStringIncludes(result, snapshot.title);
    assertStringIncludes(result, snapshot.reference_id);
    assertStringIncludes(result, snapshot.content);
    assertStringIncludes(result, snapshot.id);
  } finally {
    await deleteNoteSnapshotById(snapshot.id);
  }
});

Deno.test("get_note_snapshot fetches by reference_id", async () => {
  const snapshot = await createNoteSnapshot();
  try {
    const result = await callTool("get_note_snapshot", {
      reference_id: snapshot.reference_id,
    });
    assertStringIncludes(result, snapshot.title);
    assertStringIncludes(result, snapshot.content);
    assertStringIncludes(result, snapshot.reference_id);
  } finally {
    await deleteNoteSnapshotById(snapshot.id);
  }
});

Deno.test("get_note_snapshot prefers id over reference_id when both provided", async () => {
  const markerA = `Content AAA unique marker ${uniqueToken()}`;
  const markerB = `Content BBB unique marker ${uniqueToken()}`;
  const snapshotA = await createNoteSnapshot({ content: markerA });
  let snapshotBId = "";
  try {
    const snapshotB = await createNoteSnapshot({ content: markerB });
    snapshotBId = snapshotB.id;
    const result = await callTool("get_note_snapshot", {
      id: snapshotA.id,
      reference_id: snapshotB.reference_id,
    });
    assertStringIncludes(result, markerA);
    assertEquals(result.includes(markerB), false);
  } finally {
    await deleteNoteSnapshotById(snapshotA.id);
    if (snapshotBId) await deleteNoteSnapshotById(snapshotBId);
  }
});

Deno.test("get_note_snapshot returns error when neither id nor reference_id provided", async () => {
  const result = await callToolRaw("get_note_snapshot", {});
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "Must provide");
});

Deno.test("get_note_snapshot returns error for non-existent id", async () => {
  const result = await callToolRaw("get_note_snapshot", {
    id: "00000000-0000-0000-0000-999999999999",
  });
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "not found");
});

Deno.test("get_note_snapshot returns error for non-existent reference_id", async () => {
  const result = await callToolRaw("get_note_snapshot", {
    reference_id: `does-not-exist-${uniqueToken()}.md`,
  });
  assertEquals(result.isError, true);
  assertStringIncludes(result.text, "not found");
});
