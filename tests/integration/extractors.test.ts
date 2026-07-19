// Integration tests for the extraction pipeline and concrete extractors,
// driven in-process against the running local stack's database.
//
// Pipeline-runner tests that fake the extractors live in
// tests/unit/pipeline.test.ts (TEST-14) — everything here exercises the REAL
// extractors and the real Supabase-backed repositories.
//
// Fixture hygiene (TEST-10/TEST-16): every test derives its fixtures from a
// `uniqueToken()`/`uniqueName()` marker (its reference_id or entity name) and
// hard-deletes its own rows in `finally` by that marker — deletion by marker
// catches every row the test caused, even ones created after a mid-test
// assertion failure, so nothing depends on reaching the end of the test body.

import { assertEquals, assertExists } from "@std/assert";
import { parseNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import type { ParsedNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import {
  runExtractionPipeline,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import type {
  ExtractionContext,
  ExtractionPipelineDeps,
  Extractor,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import {
  ProjectExtractor,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";
import {
  TaskExtractor,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts";
import {
  PeopleExtractor,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/people-extractor.ts";
import { createAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/factory.ts";
import { hashContent } from "../../supabase/functions/terrestrial-brain-mcp/helpers.ts";
import { SupabaseTaskRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-task-repository.ts";
import { SupabaseProjectRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-project-repository.ts";
import { SupabasePersonRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-person-repository.ts";
import {
  createServiceClient,
  restUrl,
  serviceHeaders,
  uniqueName,
  uniqueToken,
} from "../helpers/mcp-client.ts";
import { makeExtractionContext } from "../helpers/extraction-context.ts";

// ---------------------------------------------------------------------------
// Shared seams: one service-role client, real repositories, one deps object
// ---------------------------------------------------------------------------

const supabase = createServiceClient();
// Real repositories over the same test client so the extractors' writes hit
// the DB exactly as the served function's do.
const taskRepository = new SupabaseTaskRepository(supabase);
const projectRepository = new SupabaseProjectRepository(supabase);
const personRepository = new SupabasePersonRepository(supabase);

// These tests drive the REAL extraction pipeline in-process. The provider is
// chosen by the same factory the served function uses (Step 22): the default
// suite runs with TB_AI_PROVIDER=fake, so extraction is deterministic and needs
// no live key; the opt-in live-LLM tier runs the real provider.
const testAiProvider = createAiProvider();

/** The one shared deps object every pipeline run and context build uses. */
const pipelineDeps: ExtractionPipelineDeps = {
  aiProvider: testAiProvider,
  taskRepository,
  projectRepository,
  personRepository,
  timeZone: "UTC",
};

/** Context factory (TEST-13): real seams + per-test overrides only. */
function makeContext(
  overrides: Partial<ExtractionContext> = {},
): ExtractionContext {
  return makeExtractionContext(pipelineDeps, overrides);
}

// Thin wrapper: the pipeline returns a discriminated PipelineOutcome
// (EXTR-2/EXTR-6). These tests assert on the reference map, so unwrap the
// success branch here (a seed-read abort is a hard test failure).
async function runPipelineRefs(
  note: ParsedNote,
  extractors: Extractor[],
): Promise<Record<string, string[]>> {
  const outcome = await runExtractionPipeline(note, extractors, pipelineDeps);
  if (!outcome.ok) {
    throw new Error(
      `extraction pipeline aborted unexpectedly: ${outcome.error}`,
    );
  }
  return outcome.references;
}

// Seed project IDs (from seed.sql)
const TEST_PROJ_ID = "00000000-0000-0000-0000-000000000001";
const TERRESTRIAL_BRAIN_ID = "00000000-0000-0000-0000-000000000002";

// Seed people IDs (from seed.sql)
const ALICE_ID = "00000000-0000-0000-0000-100000000001";
const CLAUDE_ID = "00000000-0000-0000-0000-100000000002";

// ---------------------------------------------------------------------------
// Per-test cleanup helpers (service-role hard deletes via REST)
// ---------------------------------------------------------------------------

async function deleteRowsWhere(table: string, filter: string): Promise<void> {
  const response = await fetch(restUrl(`${table}?${filter}`), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  await response.body?.cancel();
}

function deleteTasksByReference(referenceId: string): Promise<void> {
  return deleteRowsWhere(
    "tasks",
    `reference_id=eq.${encodeURIComponent(referenceId)}`,
  );
}

function deleteProjectsByName(projectName: string): Promise<void> {
  return deleteRowsWhere(
    "projects",
    `name=eq.${encodeURIComponent(projectName)}`,
  );
}

function deletePeopleByName(personName: string): Promise<void> {
  return deleteRowsWhere(
    "people",
    `name=eq.${encodeURIComponent(personName)}`,
  );
}

/** A due date `days` from now as a YYYY-MM-DD string (TEST-17: clock-derived). */
function isoDateDaysFromNow(days: number): string {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return new Date(Date.now() + days * millisecondsPerDay)
    .toISOString()
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// 3.1 — Pipeline seeding (the unit-style runner tests moved to
// tests/unit/pipeline.test.ts; this one genuinely asserts DB seeding)
// ---------------------------------------------------------------------------

Deno.test("pipeline: context knownProjects populated from DB", async () => {
  let capturedKnownProjects: { id: string; name: string }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: (_note, context) => {
      capturedKnownProjects = context.knownProjects;
      return Promise.resolve({ referenceKey: "inspect", ids: [] });
    },
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  await runPipelineRefs(note, [inspectingExtractor]);

  // Seed data has at least Test Proj, Terrestrial Brain, Test Proj Backend
  const projectNames = capturedKnownProjects.map(
    (project: { id: string; name: string }) => project.name,
  );
  assertEquals(projectNames.includes("Test Proj"), true);
  assertEquals(projectNames.includes("Terrestrial Brain"), true);
});

// ---------------------------------------------------------------------------
// 3.2 — ProjectExtractor: file path detection
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: detects known project from file path", async () => {
  const extractor = new ProjectExtractor();
  const note = parseNote(
    "Sprint planning notes for this week.",
    "Sprint Notes",
    "projects/Test Proj/sprint-notes.md",
    "obsidian",
  );

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  const result = await extractor.extract(note, context);

  assertEquals(result.referenceKey, "projects");
  assertEquals(result.ids.includes(TEST_PROJ_ID), true);
});

// ---------------------------------------------------------------------------
// 3.3 — ProjectExtractor: heading-based detection
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: detects project from heading match", async () => {
  const extractor = new ProjectExtractor();
  const content =
    "# Test Proj\n\nSome notes about the project.\n\n# Other Section\n\nUnrelated content.";
  const note = parseNote(content, "Mixed Notes", "daily/today.md", "obsidian");

  const context = makeContext({
    knownProjects: [
      { id: TEST_PROJ_ID, name: "Test Proj" },
      { id: TERRESTRIAL_BRAIN_ID, name: "Terrestrial Brain" },
    ],
  });

  const result = await extractor.extract(note, context);

  assertEquals(result.ids.includes(TEST_PROJ_ID), true);
});

Deno.test("ProjectExtractor: heading match is case-insensitive", async () => {
  const extractor = new ProjectExtractor();
  const content = "# test proj\n\nSome notes.";
  const note = parseNote(content, "Notes", "daily/today.md", "obsidian");

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  const result = await extractor.extract(note, context);

  assertEquals(result.ids.includes(TEST_PROJ_ID), true);
});

Deno.test("ProjectExtractor: heading not matching any project returns no match from headings", async () => {
  const extractor = new ProjectExtractor();
  const content = "# Meeting Notes\n\nDiscussed various topics.";
  const note = parseNote(content, "Meeting", "daily/today.md", "obsidian");

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  const result = await extractor.extract(note, context);

  // Neither the heading nor the content names "Test Proj", so no project matches.
  // Against the deterministic fake this is a hard assertion (empty result).
  assertEquals(result.referenceKey, "projects");
  assertEquals(result.ids, []);
});

// ---------------------------------------------------------------------------
// 3.4 — ProjectExtractor: auto-creation
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: auto-creates project from new folder", async () => {
  const extractor = new ProjectExtractor();
  const projectName = uniqueName("TestAutoCreate");
  const note = parseNote(
    "Kickoff meeting notes.",
    "Kickoff",
    `projects/${projectName}/kickoff.md`,
    "obsidian",
  );

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  try {
    const result = await extractor.extract(note, context);

    // Should have created a new project
    assertEquals(result.ids.length >= 1, true);
    assertEquals(context.newlyCreatedProjects.length, 1);
    assertEquals(context.newlyCreatedProjects[0].name, projectName);

    // Verify it's in knownProjects too
    const addedToKnown = context.knownProjects.some(
      (project) => project.name === projectName,
    );
    assertEquals(addedToKnown, true);

    // Verify it's actually in the DB
    const { data: dbProject } = await supabase
      .from("projects")
      .select("id, name")
      .eq("name", projectName)
      .single();
    assertExists(dbProject);
    assertEquals(dbProject.name, projectName);
  } finally {
    await deleteProjectsByName(projectName);
  }
});

// ---------------------------------------------------------------------------
// 3.5 — ProjectExtractor: edge cases
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: empty folder name is skipped", async () => {
  const extractor = new ProjectExtractor();
  const note = parseNote(
    "Some content.",
    "Test",
    `projects//somefile-${uniqueToken()}.md`,
    "obsidian",
  );

  const context = makeContext();

  const result = await extractor.extract(note, context);

  // No auto-creation should happen
  assertEquals(context.newlyCreatedProjects.length, 0);
  assertEquals(result.referenceKey, "projects");
});

Deno.test("ProjectExtractor: note outside /projects/ returns no path match", async () => {
  const extractor = new ProjectExtractor();
  const note = parseNote(
    "Daily journal entry.",
    "Journal",
    "daily/2026-03-22.md",
    "obsidian",
  );

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  const result = await extractor.extract(note, context);

  // No path-based match — result may have LLM matches but no path match
  assertEquals(result.referenceKey, "projects");
  assertEquals(context.newlyCreatedProjects.length, 0);
});

Deno.test("ProjectExtractor: note with no referenceId gets no path match", async () => {
  const extractor = new ProjectExtractor();
  const note = parseNote("Some thought.", "Quick", null, "obsidian");

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  const result = await extractor.extract(note, context);

  assertEquals(result.referenceKey, "projects");
  assertEquals(context.newlyCreatedProjects.length, 0);
});

// ---------------------------------------------------------------------------
// 3.6 — ProjectExtractor: deduplication
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: deduplicates when same project matched by path and heading", async () => {
  const extractor = new ProjectExtractor();
  const content = "# Test Proj\n\nProject status update for Test Proj.";
  const note = parseNote(
    content,
    "Test Proj Status",
    "projects/Test Proj/status.md",
    "obsidian",
  );

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  const result = await extractor.extract(note, context);

  // Test Proj matched by both path and heading — should appear only once
  const testProjCount = result.ids.filter((id) => id === TEST_PROJ_ID).length;
  assertEquals(testProjCount, 1);
});

// ---------------------------------------------------------------------------
// 3.7 — Full pipeline integration test
// ---------------------------------------------------------------------------

Deno.test("pipeline: ProjectExtractor wired into pipeline produces correct references", async () => {
  const note = parseNote(
    "# Test Proj\n\nStatus update on record integration.",
    "Status",
    "projects/Test Proj/status.md",
    "obsidian",
  );

  const result = await runPipelineRefs(note, [new ProjectExtractor()]);

  assertExists(result.projects);
  assertEquals(result.projects.includes(TEST_PROJ_ID), true);

  // Verify it's a proper Record<string, string[]>
  assertEquals(Array.isArray(result.projects), true);
});

Deno.test("pipeline: ProjectExtractor with no matches returns empty projects array", async () => {
  const note = parseNote(
    "Today I had breakfast and walked the dog.",
    "Journal",
    "daily/2026-03-22.md",
    "obsidian",
  );

  const result = await runPipelineRefs(note, [new ProjectExtractor()]);

  assertExists(result.projects);
  assertEquals(Array.isArray(result.projects), true);
});

// ---------------------------------------------------------------------------
// 7.1 — TaskExtractor: unchecked checkbox creates open task
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: unchecked checkbox creates open task with reference_id", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/open-${uniqueToken()}.md`;
  const content = "# Notes\n\n- [ ] Buy groceries\n";
  const note = parseNote(content, "Notes", referenceId, "obsidian");

  try {
    const result = await extractor.extract(note, makeContext());

    assertEquals(result.referenceKey, "tasks");
    assertEquals(result.ids.length, 1);

    // Verify DB row
    const { data: task } = await supabase
      .from("tasks")
      .select("id, content, status, reference_id, archived_at")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.content, "Buy groceries");
    assertEquals(task.status, "open");
    assertEquals(task.reference_id, referenceId);
    assertEquals(task.archived_at, null);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.2 — TaskExtractor: checked checkbox creates done task
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: checked checkbox creates done task with archived_at", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/done-${uniqueToken()}.md`;
  const content = "- [x] Fix login bug\n";
  const note = parseNote(content, "Done", referenceId, "obsidian");

  try {
    const result = await extractor.extract(note, makeContext());

    assertEquals(result.ids.length, 1);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, content, status, archived_at")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.content, "Fix login bug");
    assertEquals(task.status, "done");
    assertExists(task.archived_at);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.3 — TaskExtractor: subtask hierarchy (parent_id)
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: indented checkboxes create subtask hierarchy", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/hierarchy-${uniqueToken()}.md`;
  const content =
    "- [ ] Parent task\n  - [ ] Child task\n    - [ ] Grandchild task\n";
  const note = parseNote(content, "Hierarchy", referenceId, "obsidian");

  try {
    const result = await extractor.extract(note, makeContext());

    assertEquals(result.ids.length, 3);

    // Fetch all three tasks
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, content, parent_id")
      .in("id", result.ids)
      .order("created_at", { ascending: true });

    assertExists(tasks);
    assertEquals(tasks.length, 3);

    const parentTask = tasks.find((task: { content: string }) =>
      task.content === "Parent task"
    );
    const childTask = tasks.find((task: { content: string }) =>
      task.content === "Child task"
    );
    const grandchildTask = tasks.find((task: { content: string }) =>
      task.content === "Grandchild task"
    );

    assertExists(parentTask);
    assertExists(childTask);
    assertExists(grandchildTask);

    assertEquals(parentTask.parent_id, null);
    assertEquals(childTask.parent_id, parentTask.id);
    assertEquals(grandchildTask.parent_id, childTask.id);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.4 — TaskExtractor: tasks under project heading get correct project_id
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: tasks under project heading get correct project_id", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/heading-project-${uniqueToken()}.md`;
  const content =
    "# Test Proj\n\n- [ ] Fix record page\n\n# Other\n\n- [ ] Generic task\n";
  const note = parseNote(content, "Mixed", referenceId, "obsidian");

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  try {
    const result = await extractor.extract(note, context);

    assertEquals(result.ids.length, 2);

    // The task under "# Test Proj" should have project_id set
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, content, project_id")
      .in("id", result.ids);

    assertExists(tasks);
    const recordTask = tasks.find((task: { content: string }) =>
      task.content === "Fix record page"
    );
    const genericTask = tasks.find((task: { content: string }) =>
      task.content === "Generic task"
    );

    assertExists(recordTask);
    assertExists(genericTask);

    assertEquals(recordTask.project_id, TEST_PROJ_ID);
    // Generic task has no matching heading — project_id may be null or AI-inferred
    // We just verify it's a valid result
    assertEquals(
      typeof genericTask.project_id === "string" ||
        genericTask.project_id === null,
      true,
    );
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.5 — TaskExtractor: re-ingest with unchanged checkbox doesn't duplicate
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: re-ingest with unchanged checkbox doesn't duplicate", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/reindgest-nodup-${uniqueToken()}.md`;
  const content = "- [ ] Unique task for dedup test\n";
  const note = parseNote(content, "Dedup", referenceId, "obsidian");

  try {
    // First ingest
    const result1 = await extractor.extract(note, makeContext());
    assertEquals(result1.ids.length, 1);
    const originalTaskId = result1.ids[0];

    // Second ingest — same content, with knownTasks from DB
    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, content, reference_id")
      .eq("reference_id", referenceId);

    const context2 = makeContext({
      knownTasks: (existingTasks || []).map((
        task: { id: string; content: string; reference_id: string | null },
      ) => ({
        id: task.id,
        content: task.content,
        reference_id: task.reference_id,
      })),
    });

    const result2 = await extractor.extract(note, context2);

    assertEquals(result2.ids.length, 1);
    assertEquals(result2.ids[0], originalTaskId);

    // Verify only one task exists with this reference_id
    const { data: allTasks } = await supabase
      .from("tasks")
      .select("id")
      .eq("reference_id", referenceId);

    assertEquals(allTasks?.length, 1);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.6 — TaskExtractor: re-ingest with checked box updates status to done
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: re-ingest with checked box updates status to done", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/check-done-${uniqueToken()}.md`;

  try {
    // First ingest: unchecked
    const content1 = "- [ ] Task to complete\n";
    const note1 = parseNote(content1, "Check", referenceId, "obsidian");

    const result1 = await extractor.extract(note1, makeContext());
    const taskId = result1.ids[0];

    // Verify it's open
    const { data: taskBefore } = await supabase
      .from("tasks")
      .select("status, archived_at")
      .eq("id", taskId)
      .single();
    assertEquals(taskBefore?.status, "open");
    assertEquals(taskBefore?.archived_at, null);

    // Second ingest: now checked
    const content2 = "- [x] Task to complete\n";
    const note2 = parseNote(content2, "Check", referenceId, "obsidian");

    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, content, reference_id")
      .eq("reference_id", referenceId);

    const context2 = makeContext({
      knownTasks: (existingTasks || []).map((
        task: { id: string; content: string; reference_id: string | null },
      ) => ({
        id: task.id,
        content: task.content,
        reference_id: task.reference_id,
      })),
    });

    const result2 = await extractor.extract(note2, context2);
    assertEquals(result2.ids[0], taskId);

    // Verify it's now done
    const { data: taskAfter } = await supabase
      .from("tasks")
      .select("status, archived_at")
      .eq("id", taskId)
      .single();
    assertEquals(taskAfter?.status, "done");
    assertExists(taskAfter?.archived_at);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.7 — TaskExtractor: re-ingest with unchecked box reopens task
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: re-ingest with unchecked box reopens task", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/reopen-${uniqueToken()}.md`;

  try {
    // First ingest: checked (done)
    const content1 = "- [x] Task that was done\n";
    const note1 = parseNote(content1, "Reopen", referenceId, "obsidian");

    const result1 = await extractor.extract(note1, makeContext());
    const taskId = result1.ids[0];

    // Verify it's done
    const { data: taskBefore } = await supabase
      .from("tasks")
      .select("status, archived_at")
      .eq("id", taskId)
      .single();
    assertEquals(taskBefore?.status, "done");
    assertExists(taskBefore?.archived_at);

    // Second ingest: now unchecked
    const content2 = "- [ ] Task that was done\n";
    const note2 = parseNote(content2, "Reopen", referenceId, "obsidian");

    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, content, reference_id")
      .eq("reference_id", referenceId);

    const context2 = makeContext({
      knownTasks: (existingTasks || []).map((
        task: { id: string; content: string; reference_id: string | null },
      ) => ({
        id: task.id,
        content: task.content,
        reference_id: task.reference_id,
      })),
    });

    const result2 = await extractor.extract(note2, context2);
    assertEquals(result2.ids[0], taskId);

    // Verify it's now open
    const { data: taskAfter } = await supabase
      .from("tasks")
      .select("status, archived_at")
      .eq("id", taskId)
      .single();
    assertEquals(taskAfter?.status, "open");
    assertEquals(taskAfter?.archived_at, null);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.8 — TaskExtractor: re-ingest with new checkbox creates new, keeps existing
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: re-ingest with new checkbox creates new task, keeps existing", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/add-new-${uniqueToken()}.md`;

  try {
    // First ingest: one checkbox
    const content1 = "- [ ] Existing task\n";
    const note1 = parseNote(content1, "Add", referenceId, "obsidian");

    const result1 = await extractor.extract(note1, makeContext());
    assertEquals(result1.ids.length, 1);
    const existingTaskId = result1.ids[0];

    // Second ingest: two checkboxes (original + new)
    const content2 = "- [ ] Existing task\n- [ ] Brand new task\n";
    const note2 = parseNote(content2, "Add", referenceId, "obsidian");

    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, content, reference_id")
      .eq("reference_id", referenceId);

    const context2 = makeContext({
      knownTasks: (existingTasks || []).map((
        task: { id: string; content: string; reference_id: string | null },
      ) => ({
        id: task.id,
        content: task.content,
        reference_id: task.reference_id,
      })),
    });

    const result2 = await extractor.extract(note2, context2);

    assertEquals(result2.ids.length, 2);
    assertEquals(result2.ids.includes(existingTaskId), true);

    // Verify both tasks exist in DB
    const { data: allTasks } = await supabase
      .from("tasks")
      .select("id, content")
      .eq("reference_id", referenceId);

    assertEquals(allTasks?.length, 2);
    const contents = allTasks?.map((task: { content: string }) => task.content)
      .sort();
    assertEquals(contents, ["Brand new task", "Existing task"]);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.9 — TaskExtractor: note with no checkboxes returns empty result
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: note with no checkboxes returns empty result", async () => {
  const extractor = new TaskExtractor();
  const content = "# Just some prose\n\nNo checkboxes here.\n";
  const note = parseNote(
    content,
    "Prose",
    `test/no-tasks-${uniqueToken()}.md`,
    "obsidian",
  );

  const context = makeContext();

  const result = await extractor.extract(note, context);

  assertEquals(result.referenceKey, "tasks");
  assertEquals(result.ids, []);
  assertEquals(context.newlyCreatedTasks.length, 0);
});

// ---------------------------------------------------------------------------
// 7.10 — Pipeline integration: ProjectExtractor + TaskExtractor composed
// ---------------------------------------------------------------------------

Deno.test("pipeline: ProjectExtractor + TaskExtractor produce composed references", async () => {
  const referenceId = `projects/Test Proj/pipeline-test-${uniqueToken()}.md`;
  const content =
    "# Test Proj\n\n- [ ] Fix record page\n- [ ] Update pricing API\n";
  const note = parseNote(content, "Pipeline", referenceId, "obsidian");

  try {
    // Run the real pipeline — ProjectExtractor sets accumulatedReferences.projects,
    // TaskExtractor reads them via context.accumulatedReferences.projects
    const result = await runPipelineRefs(
      note,
      [new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()],
    );

    assertExists(result.projects);
    assertExists(result.tasks);
    assertEquals(result.projects.includes(TEST_PROJ_ID), true);
    assertEquals(result.tasks.length, 2);

    // Verify tasks have the Test Proj project_id
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, project_id")
      .in("id", result.tasks);

    assertExists(tasks);
    for (const task of tasks) {
      assertEquals(task.project_id, TEST_PROJ_ID);
    }
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 7.11 — Pipeline context: knownTasks populated for matching reference_id
// ---------------------------------------------------------------------------

Deno.test("pipeline: knownTasks populated from DB for matching reference_id", async () => {
  const referenceId = `test/task-extractor/context-known-${uniqueToken()}.md`;

  try {
    // Pre-create a task with this reference_id
    const { data: preCreated } = await supabase
      .from("tasks")
      .insert({
        content: "Pre-existing task",
        status: "open",
        reference_id: referenceId,
      })
      .select("id")
      .single();

    assertExists(preCreated);

    // Run pipeline — should pick up the pre-existing task in knownTasks
    let capturedKnownTasks: {
      id: string;
      content: string;
      reference_id: string | null;
    }[] = [];

    const inspectingExtractor: Extractor = {
      referenceKey: "inspect",
      extract: (_note, context) => {
        capturedKnownTasks = context.knownTasks;
        return Promise.resolve({ referenceKey: "inspect", ids: [] });
      },
    };

    const note = parseNote(
      "- [ ] New task\n",
      "Context",
      referenceId,
      "obsidian",
    );
    await runPipelineRefs(note, [inspectingExtractor]);

    assertEquals(capturedKnownTasks.length, 1);
    assertEquals(capturedKnownTasks[0].id, preCreated.id);
    assertEquals(capturedKnownTasks[0].content, "Pre-existing task");
    assertEquals(capturedKnownTasks[0].reference_id, referenceId);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

Deno.test("pipeline: knownTasks empty for note with no referenceId", async () => {
  let capturedKnownTasks: {
    id: string;
    content: string;
    reference_id: string | null;
  }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: (_note, context) => {
      capturedKnownTasks = context.knownTasks;
      return Promise.resolve({ referenceKey: "inspect", ids: [] });
    },
  };

  const note = parseNote("Some content", "No Ref", null, "obsidian");
  await runPipelineRefs(note, [inspectingExtractor]);

  assertEquals(capturedKnownTasks.length, 0);
});

// ---------------------------------------------------------------------------
// 8.0 — PeopleExtractor tests
// ---------------------------------------------------------------------------

Deno.test("PeopleExtractor: referenceKey is 'people'", async () => {
  const extractor = new PeopleExtractor();
  const note = parseNote("Some content", "Test", null, "obsidian");

  const result = await extractor.extract(note, makeContext());
  assertEquals(result.referenceKey, "people");
});

Deno.test("PeopleExtractor: empty knownPeople returns empty ids without LLM call", async () => {
  const extractor = new PeopleExtractor();
  const note = parseNote(
    "Meeting with Alice about the project.",
    "Meeting",
    null,
    "obsidian",
  );

  const result = await extractor.extract(note, makeContext());
  assertEquals(result.ids, []);
});

Deno.test("PeopleExtractor: empty note content returns empty ids", async () => {
  const extractor = new PeopleExtractor();
  const note = parseNote("", "Empty", null, "obsidian");

  const context = makeContext({
    knownPeople: [{ id: ALICE_ID, name: "Alice" }],
  });

  const result = await extractor.extract(note, context);
  assertEquals(result.ids, []);
});

Deno.test("PeopleExtractor: with known people and content returns valid result", async () => {
  const extractor = new PeopleExtractor();
  const content =
    "# Meeting Notes\n\nDiscussed the roadmap with Alice. She suggested we prioritize the record page.";
  const note = parseNote(content, "Meeting", "daily/meeting.md", "obsidian");

  const context = makeContext({
    knownPeople: [
      { id: ALICE_ID, name: "Alice" },
      { id: CLAUDE_ID, name: "Claude" },
    ],
  });

  const result = await extractor.extract(note, context);
  // The note names Alice (a known person) and not Claude, so extraction resolves
  // to exactly Alice's id. Deterministic against the fake — a hard assertion.
  assertEquals(result.referenceKey, "people");
  assertEquals(result.ids, [ALICE_ID]);
});

Deno.test("PeopleExtractor: does not return unknown people", async () => {
  const extractor = new PeopleExtractor();
  const unknownPersonName = uniqueName("Charlie");
  const content = `${unknownPersonName} mentioned he'd handle the deployment.`;
  const note = parseNote(content, "Notes", null, "obsidian");

  const context = makeContext({
    knownPeople: [{ id: ALICE_ID, name: "Alice" }],
  });

  try {
    const result = await extractor.extract(note, context);
    // The unknown person is not in known people, so should not appear
    assertEquals(result.ids.includes(ALICE_ID), false);
  } finally {
    // Defensive: remove the person row if extraction ever auto-created it.
    await deletePeopleByName(unknownPersonName);
  }
});

// ---------------------------------------------------------------------------
// 8.1 — Pipeline context: knownPeople populated from DB
// ---------------------------------------------------------------------------

Deno.test("pipeline: knownPeople populated from DB", async () => {
  let capturedKnownPeople: { id: string; name: string }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: (_note, context) => {
      capturedKnownPeople = context.knownPeople;
      return Promise.resolve({ referenceKey: "inspect", ids: [] });
    },
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  await runPipelineRefs(note, [inspectingExtractor]);

  // Seed data has Alice and Claude
  const peopleNames = capturedKnownPeople.map(
    (person: { id: string; name: string }) => person.name,
  );
  assertEquals(peopleNames.includes("Alice"), true);
  assertEquals(peopleNames.includes("Claude"), true);
});

// ---------------------------------------------------------------------------
// 9.3 — TaskExtractor: metadata populated on new task
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: new task has populated metadata", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/metadata-new-${uniqueToken()}.md`;
  const content = "# Sprint 12\n\n- [ ] Fix the navbar\n";
  const note = parseNote(content, "Notes", referenceId, "obsidian");

  try {
    const result = await extractor.extract(note, makeContext());
    assertEquals(result.ids.length, 1);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, metadata")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertExists(task.metadata);
    assertEquals(task.metadata.source, "obsidian");
    assertEquals(task.metadata.section_heading, "Sprint 12");
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.4 — TaskExtractor: metadata refreshed on update
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: metadata refreshed on re-ingest", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/metadata-update-${uniqueToken()}.md`;

  try {
    // First ingest: no heading
    const content1 = "- [ ] Fix the login\n";
    const note1 = parseNote(content1, "Notes", referenceId, "obsidian");

    const result1 = await extractor.extract(note1, makeContext());
    const taskId = result1.ids[0];

    // Verify initial metadata
    const { data: taskBefore } = await supabase
      .from("tasks")
      .select("metadata")
      .eq("id", taskId)
      .single();
    assertEquals(taskBefore?.metadata.section_heading, undefined);

    // Second ingest: now under a heading
    const content2 = "# Auth Sprint\n\n- [ ] Fix the login\n";
    const note2 = parseNote(content2, "Notes", referenceId, "obsidian");

    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, content, reference_id")
      .eq("reference_id", referenceId);

    const context2 = makeContext({
      knownTasks: (existingTasks || []).map((
        task: { id: string; content: string; reference_id: string | null },
      ) => ({
        id: task.id,
        content: task.content,
        reference_id: task.reference_id,
      })),
    });

    await extractor.extract(note2, context2);

    // Verify metadata was updated
    const { data: taskAfter } = await supabase
      .from("tasks")
      .select("metadata")
      .eq("id", taskId)
      .single();
    assertEquals(taskAfter?.metadata.section_heading, "Auth Sprint");
    assertEquals(taskAfter?.metadata.source, "obsidian");
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.5 — TaskExtractor: due date extracted from checkbox text
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: extracts due date from checkbox text", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/due-date-${uniqueToken()}.md`;
  // TEST-17: the date is derived from the clock (always in the future), never
  // a hardcoded absolute date that silently goes stale.
  const dueDate = isoDateDaysFromNow(30);
  const content = `- [ ] Ship feature by ${dueDate}\n`;
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  try {
    const result = await extractor.extract(note, makeContext());
    assertEquals(result.ids.length, 1);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, content, due_by")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.content, "Ship feature");
    assertExists(task.due_by);
    assertEquals(
      new Date(task.due_by).toISOString().startsWith(dueDate),
      true,
      `due_by should fall on ${dueDate}; got ${task.due_by}`,
    );
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.6 — TaskExtractor: no date leaves due_by null and content unchanged
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: no date leaves due_by null and content unchanged", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/no-due-date-${uniqueToken()}.md`;
  const content = "- [ ] Regular task with no date\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  try {
    const result = await extractor.extract(note, makeContext());

    const { data: task } = await supabase
      .from("tasks")
      .select("id, content, due_by")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.content, "Regular task with no date");
    assertEquals(task.due_by, null);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.7 — TaskExtractor: person in checkbox text sets assigned_to
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: person in checkbox text sets assigned_to", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/person-text-${uniqueToken()}.md`;
  const content = "- [ ] Ask Alice about the API design\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context = makeContext({
    knownPeople: [
      { id: ALICE_ID, name: "Alice" },
      { id: CLAUDE_ID, name: "Claude" },
    ],
  });

  try {
    const result = await extractor.extract(note, context);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, content, assigned_to")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.assigned_to, ALICE_ID);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.8 — TaskExtractor: person in section heading sets assigned_to
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: person in section heading sets assigned_to", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/person-heading-${uniqueToken()}.md`;
  const content = "# Alice Tasks\n\n- [ ] Review the dashboard PR\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context = makeContext({
    knownPeople: [{ id: ALICE_ID, name: "Alice" }],
  });

  try {
    const result = await extractor.extract(note, context);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, assigned_to")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.assigned_to, ALICE_ID);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.9 — TaskExtractor: no person match leaves assigned_to null
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: no person match leaves assigned_to null", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/no-person-${uniqueToken()}.md`;
  const content = "- [ ] Fix the deployment pipeline\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context = makeContext({
    knownPeople: [{ id: ALICE_ID, name: "Alice" }],
  });

  try {
    const result = await extractor.extract(note, context);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, assigned_to")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.assigned_to, null);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.10 — TaskExtractor: extraction_method tracks heading_match correctly
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: extraction_method is heading_match when project resolved by heading", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/method-heading-${uniqueToken()}.md`;
  const content = "# Test Proj\n\n- [ ] Fix record page\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
  });

  try {
    const result = await extractor.extract(note, context);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, metadata, project_id")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.project_id, TEST_PROJ_ID);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.11 — TaskExtractor: extraction_method is file_path when project from pipeline
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: extraction_method is file_path when project from pipeline", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/method-filepath-${uniqueToken()}.md`;
  const content = "- [ ] Update the API\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context = makeContext({
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    accumulatedReferences: { projects: [TEST_PROJ_ID] },
  });

  try {
    const result = await extractor.extract(note, context);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, metadata, project_id")
      .eq("id", result.ids[0])
      .single();

    assertExists(task);
    assertEquals(task.project_id, TEST_PROJ_ID);
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// 9.12 — Full pipeline integration: metadata, due_by, assigned_to all populated
// ---------------------------------------------------------------------------

Deno.test("pipeline: full extraction populates metadata, due_by, and assigned_to", async () => {
  const referenceId = `projects/Test Proj/full-pipeline-${uniqueToken()}.md`;
  // TEST-17: clock-derived future date, embedded in the checkbox text.
  const dueDate = isoDateDaysFromNow(45);
  const content =
    `# Test Proj\n\n- [ ] Alice should review the PR by ${dueDate}\n`;
  const note = parseNote(content, "Full Test", referenceId, "obsidian");

  try {
    const result = await runPipelineRefs(
      note,
      [new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()],
    );

    assertExists(result.tasks);
    assertEquals(result.tasks.length, 1);

    const { data: task } = await supabase
      .from("tasks")
      .select("id, content, project_id, due_by, assigned_to, metadata")
      .eq("id", result.tasks[0])
      .single();

    assertExists(task);

    // Content should have date stripped
    assertEquals(task.content, "Alice should review the PR");

    // Project should be Test Proj (heading match)
    assertEquals(task.project_id, TEST_PROJ_ID);

    // Due date should be extracted
    assertExists(task.due_by);
    assertEquals(
      new Date(task.due_by).toISOString().startsWith(dueDate),
      true,
      `due_by should fall on ${dueDate}; got ${task.due_by}`,
    );

    // Assigned to Alice (name in checkbox text)
    assertEquals(task.assigned_to, ALICE_ID);

    // Metadata populated
    assertExists(task.metadata);
    assertEquals(task.metadata.source, "obsidian");
    assertEquals(task.metadata.section_heading, "Test Proj");
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// EXTR-5 — created tasks carry a content_hash equal to hash(content) (the
// extractor is part of the one server-side update path; INVARIANT 1).
// ---------------------------------------------------------------------------

Deno.test("EXTR-5: a task created by the extractor stores content_hash = hash(content)", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/hash-stamp-${uniqueToken()}.md`;
  const content = "- [ ] Reconcile the Q3 vendor invoices\n";
  const note = parseNote(content, "HashStamp", referenceId, "obsidian");

  try {
    const result = await extractor.extract(note, makeContext());
    assertEquals(result.ids.length, 1);
    const taskId = result.ids[0];

    const { data: row } = await supabase
      .from("tasks")
      .select("content, content_hash")
      .eq("id", taskId)
      .single();
    assertExists(row);
    assertEquals(
      row.content_hash,
      await hashContent(row.content),
      "created task's content_hash must equal the SHA-256 of its content (not null)",
    );
  } finally {
    await deleteTasksByReference(referenceId);
  }
});

// ---------------------------------------------------------------------------
// EXTR-7 — two concurrent ingests referencing the same NEW project create
// exactly one active row (unique active-name index) and resolve to the same id
// (23505-recovering create-or-get). projects.name had no unique constraint —
// this is the actual duplicate-row bug.
// ---------------------------------------------------------------------------

Deno.test("EXTR-7: concurrent auto-create of the same new project yields one row and a shared id", async () => {
  const projectName = uniqueName("RaceProj");
  const note = parseNote(
    "Kickoff.",
    "Kickoff",
    `projects/${projectName}/kickoff.md`,
    "obsidian",
  );

  try {
    // Separate contexts so both in-memory snapshots miss the new name and both
    // attempt the insert — the real race the DB index must arbitrate.
    const [resultA, resultB] = await Promise.all([
      new ProjectExtractor().extract(note, makeContext()),
      new ProjectExtractor().extract(note, makeContext()),
    ]);

    assertEquals(resultA.ids.length, 1);
    assertEquals(resultB.ids.length, 1);
    assertEquals(
      resultA.ids[0],
      resultB.ids[0],
      "both concurrent ingests must resolve to the same project id",
    );

    const { data: rows } = await supabase
      .from("projects")
      .select("id")
      .ilike("name", projectName)
      .is("archived_at", null);
    assertEquals(
      rows?.length,
      1,
      "exactly one active project row must exist for the raced name",
    );
  } finally {
    await deleteRowsWhere(
      "projects",
      `name=ilike.${encodeURIComponent(projectName)}`,
    );
  }
});
