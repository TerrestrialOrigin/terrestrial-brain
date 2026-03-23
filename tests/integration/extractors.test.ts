import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "@supabase/supabase-js";
import { parseNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import type { ParsedNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import {
  runExtractionPipeline,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import type {
  ExtractionContext,
  ExtractionResult,
  Extractor,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import {
  ProjectExtractor,
  extractProjectFromConventionalPath,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";
import {
  TaskExtractor,
  computeSimilarity,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts";

// ---------------------------------------------------------------------------
// Supabase client for direct DB access in tests
// ---------------------------------------------------------------------------

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Seed project IDs (from seed.sql)
const CARCHIEF_ID = "00000000-0000-0000-0000-000000000001";
const TERRESTRIAL_BRAIN_ID = "00000000-0000-0000-0000-000000000002";

// Track auto-created entities for cleanup
const createdProjectIds: string[] = [];
const createdTaskIds: string[] = [];

// ---------------------------------------------------------------------------
// 3.1 — Pipeline unit tests (mock extractors)
// ---------------------------------------------------------------------------

Deno.test("pipeline: single extractor returns correct references", async () => {
  const mockExtractor: Extractor = {
    referenceKey: "projects",
    extract: async (_note: ParsedNote, _context: ExtractionContext) => ({
      referenceKey: "projects",
      ids: ["uuid-1", "uuid-2"],
    }),
  };

  const note = parseNote("Some content", "Test", null, "obsidian");
  const result = await runExtractionPipeline(note, [mockExtractor], supabase);

  assertExists(result.projects);
  assertEquals(result.projects, ["uuid-1", "uuid-2"]);
});

Deno.test("pipeline: multiple extractors compose results", async () => {
  const projectExtractor: Extractor = {
    referenceKey: "projects",
    extract: async () => ({ referenceKey: "projects", ids: ["p1"] }),
  };
  const taskExtractor: Extractor = {
    referenceKey: "tasks",
    extract: async () => ({ referenceKey: "tasks", ids: ["t1", "t2"] }),
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  const result = await runExtractionPipeline(
    note,
    [projectExtractor, taskExtractor],
    supabase,
  );

  assertEquals(result.projects, ["p1"]);
  assertEquals(result.tasks, ["t1", "t2"]);
});

Deno.test("pipeline: extractors run in sequential order", async () => {
  const executionOrder: string[] = [];

  const extractorA: Extractor = {
    referenceKey: "alpha",
    extract: async () => {
      executionOrder.push("A");
      return { referenceKey: "alpha", ids: [] };
    },
  };
  const extractorB: Extractor = {
    referenceKey: "beta",
    extract: async () => {
      executionOrder.push("B");
      return { referenceKey: "beta", ids: [] };
    },
  };
  const extractorC: Extractor = {
    referenceKey: "gamma",
    extract: async () => {
      executionOrder.push("C");
      return { referenceKey: "gamma", ids: [] };
    },
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  await runExtractionPipeline(
    note,
    [extractorA, extractorB, extractorC],
    supabase,
  );

  assertEquals(executionOrder, ["A", "B", "C"]);
});

Deno.test("pipeline: context enrichment visible to downstream extractors", async () => {
  let downstreamSawProject = false;

  const enrichingExtractor: Extractor = {
    referenceKey: "projects",
    extract: async (_note, context) => {
      context.newlyCreatedProjects.push({ id: "new-proj-id", name: "NewProj" });
      return { referenceKey: "projects", ids: ["new-proj-id"] };
    },
  };

  const observingExtractor: Extractor = {
    referenceKey: "tasks",
    extract: async (_note, context) => {
      downstreamSawProject = context.newlyCreatedProjects.some(
        (project) => project.id === "new-proj-id",
      );
      return { referenceKey: "tasks", ids: [] };
    },
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  await runExtractionPipeline(
    note,
    [enrichingExtractor, observingExtractor],
    supabase,
  );

  assertEquals(downstreamSawProject, true);
});

Deno.test("pipeline: extractor returning empty ids includes key in result", async () => {
  const emptyExtractor: Extractor = {
    referenceKey: "projects",
    extract: async () => ({ referenceKey: "projects", ids: [] }),
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  const result = await runExtractionPipeline(note, [emptyExtractor], supabase);

  assertExists(result.projects);
  assertEquals(result.projects, []);
});

Deno.test("pipeline: context knownProjects populated from DB", async () => {
  let capturedKnownProjects: { id: string; name: string }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: async (_note, context) => {
      capturedKnownProjects = context.knownProjects;
      return { referenceKey: "inspect", ids: [] };
    },
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  await runExtractionPipeline(note, [inspectingExtractor], supabase);

  // Seed data has at least CarChief, Terrestrial Brain, CarChief Backend
  const projectNames = capturedKnownProjects.map(
    (project: { id: string; name: string }) => project.name,
  );
  assertEquals(projectNames.includes("CarChief"), true);
  assertEquals(projectNames.includes("Terrestrial Brain"), true);
});

// ---------------------------------------------------------------------------
// 3.1b — extractProjectFromConventionalPath unit tests
// ---------------------------------------------------------------------------

Deno.test("extractProjectFromConventionalPath: extracts name from projects path", () => {
  assertEquals(
    extractProjectFromConventionalPath("projects/CarChief/sprint-notes.md"),
    "CarChief",
  );
});

Deno.test("extractProjectFromConventionalPath: extracts from nested path", () => {
  assertEquals(
    extractProjectFromConventionalPath("projects/CarChief/sprints/week1.md"),
    "CarChief",
  );
});

Deno.test("extractProjectFromConventionalPath: returns null for non-projects path", () => {
  assertEquals(extractProjectFromConventionalPath("daily/2026-03-22.md"), null);
});

Deno.test("extractProjectFromConventionalPath: returns null for empty folder name", () => {
  assertEquals(extractProjectFromConventionalPath("projects//somefile.md"), null);
});

Deno.test("extractProjectFromConventionalPath: returns null for null referenceId", () => {
  assertEquals(extractProjectFromConventionalPath(null), null);
});

Deno.test("extractProjectFromConventionalPath: returns null for projects without trailing slash", () => {
  assertEquals(extractProjectFromConventionalPath("projects"), null);
});

// ---------------------------------------------------------------------------
// 3.2 — ProjectExtractor: file path detection
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: detects known project from file path", async () => {
  const extractor = new ProjectExtractor();
  const note = parseNote(
    "Sprint planning notes for this week.",
    "Sprint Notes",
    "projects/CarChief/sprint-notes.md",
    "obsidian",
  );

  const context: ExtractionContext = {
    supabase,
    knownProjects: [{ id: CARCHIEF_ID, name: "CarChief" }],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.referenceKey, "projects");
  assertEquals(result.ids.includes(CARCHIEF_ID), true);
});

// ---------------------------------------------------------------------------
// 3.3 — ProjectExtractor: heading-based detection
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: detects project from heading match", async () => {
  const extractor = new ProjectExtractor();
  const content = "# CarChief\n\nSome notes about the project.\n\n# Other Section\n\nUnrelated content.";
  const note = parseNote(content, "Mixed Notes", "daily/today.md", "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [
      { id: CARCHIEF_ID, name: "CarChief" },
      { id: TERRESTRIAL_BRAIN_ID, name: "Terrestrial Brain" },
    ],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.ids.includes(CARCHIEF_ID), true);
});

Deno.test("ProjectExtractor: heading match is case-insensitive", async () => {
  const extractor = new ProjectExtractor();
  const content = "# carchief\n\nSome notes.";
  const note = parseNote(content, "Notes", "daily/today.md", "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [{ id: CARCHIEF_ID, name: "CarChief" }],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.ids.includes(CARCHIEF_ID), true);
});

Deno.test("ProjectExtractor: heading not matching any project returns no match from headings", async () => {
  const extractor = new ProjectExtractor();
  const content = "# Meeting Notes\n\nDiscussed various topics.";
  const note = parseNote(content, "Meeting", "daily/today.md", "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [{ id: CARCHIEF_ID, name: "CarChief" }],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  // LLM might or might not match — but heading detection itself won't match
  // We mainly verify it doesn't crash and returns a valid result
  assertEquals(result.referenceKey, "projects");
  assertEquals(Array.isArray(result.ids), true);
});

// ---------------------------------------------------------------------------
// 3.4 — ProjectExtractor: auto-creation
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: auto-creates project from new folder", async () => {
  const extractor = new ProjectExtractor();
  const uniqueName = `TestAutoCreate_${Date.now()}`;
  const note = parseNote(
    "Kickoff meeting notes.",
    "Kickoff",
    `projects/${uniqueName}/kickoff.md`,
    "obsidian",
  );

  const context: ExtractionContext = {
    supabase,
    knownProjects: [{ id: CARCHIEF_ID, name: "CarChief" }],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  // Should have created a new project
  assertEquals(result.ids.length >= 1, true);
  assertEquals(context.newlyCreatedProjects.length, 1);
  assertEquals(context.newlyCreatedProjects[0].name, uniqueName);

  // Verify it's in knownProjects too
  const addedToKnown = context.knownProjects.some(
    (project) => project.name === uniqueName,
  );
  assertEquals(addedToKnown, true);

  // Verify it's actually in the DB
  const { data: dbProject } = await supabase
    .from("projects")
    .select("id, name")
    .eq("name", uniqueName)
    .single();
  assertExists(dbProject);
  assertEquals(dbProject.name, uniqueName);

  // Track for cleanup
  createdProjectIds.push(dbProject.id);
});

// ---------------------------------------------------------------------------
// 3.5 — ProjectExtractor: edge cases
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: empty folder name is skipped", async () => {
  const extractor = new ProjectExtractor();
  const note = parseNote(
    "Some content.",
    "Test",
    "projects//somefile.md",
    "obsidian",
  );

  const context: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

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

  const context: ExtractionContext = {
    supabase,
    knownProjects: [{ id: CARCHIEF_ID, name: "CarChief" }],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  // No path-based match — result may have LLM matches but no path match
  assertEquals(result.referenceKey, "projects");
  assertEquals(context.newlyCreatedProjects.length, 0);
});

Deno.test("ProjectExtractor: note with no referenceId gets no path match", async () => {
  const extractor = new ProjectExtractor();
  const note = parseNote("Some thought.", "Quick", null, "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [{ id: CARCHIEF_ID, name: "CarChief" }],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.referenceKey, "projects");
  assertEquals(context.newlyCreatedProjects.length, 0);
});

// ---------------------------------------------------------------------------
// 3.6 — ProjectExtractor: deduplication
// ---------------------------------------------------------------------------

Deno.test("ProjectExtractor: deduplicates when same project matched by path and heading", async () => {
  const extractor = new ProjectExtractor();
  const content = "# CarChief\n\nProject status update for CarChief.";
  const note = parseNote(
    content,
    "CarChief Status",
    "projects/CarChief/status.md",
    "obsidian",
  );

  const context: ExtractionContext = {
    supabase,
    knownProjects: [{ id: CARCHIEF_ID, name: "CarChief" }],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  // CarChief matched by both path and heading — should appear only once
  const carchiefCount = result.ids.filter((id) => id === CARCHIEF_ID).length;
  assertEquals(carchiefCount, 1);
});

// ---------------------------------------------------------------------------
// 3.7 — Full pipeline integration test
// ---------------------------------------------------------------------------

Deno.test("pipeline: ProjectExtractor wired into pipeline produces correct references", async () => {
  const note = parseNote(
    "# CarChief\n\nStatus update on dealer integration.",
    "Status",
    "projects/CarChief/status.md",
    "obsidian",
  );

  const result = await runExtractionPipeline(
    note,
    [new ProjectExtractor()],
    supabase,
  );

  assertExists(result.projects);
  assertEquals(result.projects.includes(CARCHIEF_ID), true);

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

  const result = await runExtractionPipeline(
    note,
    [new ProjectExtractor()],
    supabase,
  );

  assertExists(result.projects);
  assertEquals(Array.isArray(result.projects), true);
});

// ---------------------------------------------------------------------------
// 7.0 — computeSimilarity unit tests
// ---------------------------------------------------------------------------

Deno.test("computeSimilarity: identical strings return 1.0", () => {
  assertEquals(computeSimilarity("Buy groceries", "Buy groceries"), 1.0);
});

Deno.test("computeSimilarity: case-insensitive identical strings return 1.0", () => {
  assertEquals(computeSimilarity("Buy Groceries", "buy groceries"), 1.0);
});

Deno.test("computeSimilarity: completely different strings return low score", () => {
  const score = computeSimilarity("Buy groceries", "Fix the login page");
  assertEquals(score < 0.5, true);
});

Deno.test("computeSimilarity: slightly edited string returns high score", () => {
  const score = computeSimilarity("Fix the navbar styling", "Fix the navbar styles");
  assertEquals(score > 0.8, true);
});

Deno.test("computeSimilarity: empty string returns 0.0", () => {
  assertEquals(computeSimilarity("", "something"), 0.0);
  assertEquals(computeSimilarity("something", ""), 0.0);
});

// ---------------------------------------------------------------------------
// 7.1 — TaskExtractor: unchecked checkbox creates open task
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: unchecked checkbox creates open task with reference_id", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/open-${Date.now()}.md`;
  const content = "# Notes\n\n- [ ] Buy groceries\n";
  const note = parseNote(content, "Notes", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

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

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 7.2 — TaskExtractor: checked checkbox creates done task
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: checked checkbox creates done task with archived_at", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/done-${Date.now()}.md`;
  const content = "- [x] Fix login bug\n";
  const note = parseNote(content, "Done", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

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

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 7.3 — TaskExtractor: subtask hierarchy (parent_id)
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: indented checkboxes create subtask hierarchy", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/hierarchy-${Date.now()}.md`;
  const content = "- [ ] Parent task\n  - [ ] Child task\n    - [ ] Grandchild task\n";
  const note = parseNote(content, "Hierarchy", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.ids.length, 3);

  // Fetch all three tasks
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, content, parent_id")
    .in("id", result.ids)
    .order("created_at", { ascending: true });

  assertExists(tasks);
  assertEquals(tasks.length, 3);

  const parentTask = tasks.find((task: { content: string }) => task.content === "Parent task");
  const childTask = tasks.find((task: { content: string }) => task.content === "Child task");
  const grandchildTask = tasks.find((task: { content: string }) => task.content === "Grandchild task");

  assertExists(parentTask);
  assertExists(childTask);
  assertExists(grandchildTask);

  assertEquals(parentTask.parent_id, null);
  assertEquals(childTask.parent_id, parentTask.id);
  assertEquals(grandchildTask.parent_id, childTask.id);

  createdTaskIds.push(...result.ids);
});

// ---------------------------------------------------------------------------
// 7.4 — TaskExtractor: tasks under project heading get correct project_id
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: tasks under project heading get correct project_id", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/heading-project-${Date.now()}.md`;
  const content = "# CarChief\n\n- [ ] Fix dealer page\n\n# Other\n\n- [ ] Generic task\n";
  const note = parseNote(content, "Mixed", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [{ id: CARCHIEF_ID, name: "CarChief" }],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.ids.length, 2);

  // The task under "# CarChief" should have project_id set
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, content, project_id")
    .in("id", result.ids);

  assertExists(tasks);
  const dealerTask = tasks.find((task: { content: string }) => task.content === "Fix dealer page");
  const genericTask = tasks.find((task: { content: string }) => task.content === "Generic task");

  assertExists(dealerTask);
  assertExists(genericTask);

  assertEquals(dealerTask.project_id, CARCHIEF_ID);
  // Generic task has no matching heading — project_id may be null or AI-inferred
  // We just verify it's a valid result
  assertEquals(typeof genericTask.project_id === "string" || genericTask.project_id === null, true);

  createdTaskIds.push(...result.ids);
});

// ---------------------------------------------------------------------------
// 7.5 — TaskExtractor: re-ingest with unchanged checkbox doesn't duplicate
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: re-ingest with unchanged checkbox doesn't duplicate", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/reindgest-nodup-${Date.now()}.md`;
  const content = "- [ ] Unique task for dedup test\n";
  const note = parseNote(content, "Dedup", referenceId, "obsidian");

  // First ingest
  const context1: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result1 = await extractor.extract(note, context1);
  assertEquals(result1.ids.length, 1);
  const originalTaskId = result1.ids[0];

  // Second ingest — same content, with knownTasks from DB
  const { data: existingTasks } = await supabase
    .from("tasks")
    .select("id, content, reference_id")
    .eq("reference_id", referenceId);

  const context2: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((task: { id: string; content: string; reference_id: string | null }) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result2 = await extractor.extract(note, context2);

  assertEquals(result2.ids.length, 1);
  assertEquals(result2.ids[0], originalTaskId);

  // Verify only one task exists with this reference_id
  const { data: allTasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("reference_id", referenceId);

  assertEquals(allTasks?.length, 1);

  createdTaskIds.push(originalTaskId);
});

// ---------------------------------------------------------------------------
// 7.6 — TaskExtractor: re-ingest with checked box updates status to done
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: re-ingest with checked box updates status to done", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/check-done-${Date.now()}.md`;

  // First ingest: unchecked
  const content1 = "- [ ] Task to complete\n";
  const note1 = parseNote(content1, "Check", referenceId, "obsidian");

  const context1: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result1 = await extractor.extract(note1, context1);
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

  const context2: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((task: { id: string; content: string; reference_id: string | null }) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

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

  createdTaskIds.push(taskId);
});

// ---------------------------------------------------------------------------
// 7.7 — TaskExtractor: re-ingest with unchecked box reopens task
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: re-ingest with unchecked box reopens task", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/reopen-${Date.now()}.md`;

  // First ingest: checked (done)
  const content1 = "- [x] Task that was done\n";
  const note1 = parseNote(content1, "Reopen", referenceId, "obsidian");

  const context1: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result1 = await extractor.extract(note1, context1);
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

  const context2: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((task: { id: string; content: string; reference_id: string | null }) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

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

  createdTaskIds.push(taskId);
});

// ---------------------------------------------------------------------------
// 7.8 — TaskExtractor: re-ingest with new checkbox creates new, keeps existing
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: re-ingest with new checkbox creates new task, keeps existing", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/add-new-${Date.now()}.md`;

  // First ingest: one checkbox
  const content1 = "- [ ] Existing task\n";
  const note1 = parseNote(content1, "Add", referenceId, "obsidian");

  const context1: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result1 = await extractor.extract(note1, context1);
  assertEquals(result1.ids.length, 1);
  const existingTaskId = result1.ids[0];

  // Second ingest: two checkboxes (original + new)
  const content2 = "- [ ] Existing task\n- [ ] Brand new task\n";
  const note2 = parseNote(content2, "Add", referenceId, "obsidian");

  const { data: existingTasks } = await supabase
    .from("tasks")
    .select("id, content, reference_id")
    .eq("reference_id", referenceId);

  const context2: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((task: { id: string; content: string; reference_id: string | null }) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result2 = await extractor.extract(note2, context2);

  assertEquals(result2.ids.length, 2);
  assertEquals(result2.ids.includes(existingTaskId), true);

  // Verify both tasks exist in DB
  const { data: allTasks } = await supabase
    .from("tasks")
    .select("id, content")
    .eq("reference_id", referenceId);

  assertEquals(allTasks?.length, 2);
  const contents = allTasks?.map((task: { content: string }) => task.content).sort();
  assertEquals(contents, ["Brand new task", "Existing task"]);

  createdTaskIds.push(...result2.ids);
});

// ---------------------------------------------------------------------------
// 7.9 — TaskExtractor: note with no checkboxes returns empty result
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: note with no checkboxes returns empty result", async () => {
  const extractor = new TaskExtractor();
  const content = "# Just some prose\n\nNo checkboxes here.\n";
  const note = parseNote(content, "Prose", "test/no-tasks.md", "obsidian");

  const context: ExtractionContext = {
    supabase,
    knownProjects: [],
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.referenceKey, "tasks");
  assertEquals(result.ids, []);
  assertEquals(context.newlyCreatedTasks.length, 0);
});

// ---------------------------------------------------------------------------
// 7.10 — Pipeline integration: ProjectExtractor + TaskExtractor composed
// ---------------------------------------------------------------------------

Deno.test("pipeline: ProjectExtractor + TaskExtractor produce composed references", async () => {
  const referenceId = `projects/CarChief/pipeline-test-${Date.now()}.md`;
  const content = "# CarChief\n\n- [ ] Fix dealer page\n- [ ] Update pricing API\n";
  const note = parseNote(content, "Pipeline", referenceId, "obsidian");

  const taskExtractor = new TaskExtractor();

  // Wire up: ProjectExtractor runs first, then TaskExtractor uses its results
  const projectExtractor = new ProjectExtractor();

  // Use a wrapper extractor that passes project results to TaskExtractor
  const wrappedTaskExtractor: Extractor = {
    referenceKey: "tasks",
    extract: async (extractorNote: ParsedNote, extractorContext: ExtractionContext) => {
      // Get the project references that would have been set by the pipeline
      const projectIds = extractorContext.knownProjects
        .filter((project) => project.name === "CarChief")
        .map((project) => project.id);
      taskExtractor.setFilePathProjectIds(projectIds);
      return taskExtractor.extract(extractorNote, extractorContext);
    },
  };

  const result = await runExtractionPipeline(
    note,
    [projectExtractor, wrappedTaskExtractor],
    supabase,
  );

  assertExists(result.projects);
  assertExists(result.tasks);
  assertEquals(result.projects.includes(CARCHIEF_ID), true);
  assertEquals(result.tasks.length, 2);

  // Verify tasks have the CarChief project_id
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, project_id")
    .in("id", result.tasks);

  assertExists(tasks);
  for (const task of tasks) {
    assertEquals(task.project_id, CARCHIEF_ID);
  }

  createdTaskIds.push(...result.tasks);
});

// ---------------------------------------------------------------------------
// 7.11 — Pipeline context: knownTasks populated for matching reference_id
// ---------------------------------------------------------------------------

Deno.test("pipeline: knownTasks populated from DB for matching reference_id", async () => {
  const referenceId = `test/task-extractor/context-known-${Date.now()}.md`;

  // Pre-create a task with this reference_id
  const { data: preCreated } = await supabase
    .from("tasks")
    .insert({ content: "Pre-existing task", status: "open", reference_id: referenceId })
    .select("id")
    .single();

  assertExists(preCreated);
  createdTaskIds.push(preCreated.id);

  // Run pipeline — should pick up the pre-existing task in knownTasks
  let capturedKnownTasks: { id: string; content: string; reference_id: string | null }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: async (_note, context) => {
      capturedKnownTasks = context.knownTasks;
      return { referenceKey: "inspect", ids: [] };
    },
  };

  const note = parseNote("- [ ] New task\n", "Context", referenceId, "obsidian");
  await runExtractionPipeline(note, [inspectingExtractor], supabase);

  assertEquals(capturedKnownTasks.length, 1);
  assertEquals(capturedKnownTasks[0].id, preCreated.id);
  assertEquals(capturedKnownTasks[0].content, "Pre-existing task");
  assertEquals(capturedKnownTasks[0].reference_id, referenceId);
});

Deno.test("pipeline: knownTasks empty for note with no referenceId", async () => {
  let capturedKnownTasks: { id: string; content: string; reference_id: string | null }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: async (_note, context) => {
      capturedKnownTasks = context.knownTasks;
      return { referenceKey: "inspect", ids: [] };
    },
  };

  const note = parseNote("Some content", "No Ref", null, "obsidian");
  await runExtractionPipeline(note, [inspectingExtractor], supabase);

  assertEquals(capturedKnownTasks.length, 0);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

Deno.test("cleanup: remove auto-created test tasks", async () => {
  for (const taskId of createdTaskIds) {
    await supabase.from("tasks").delete().eq("id", taskId);
  }
  assertEquals(true, true);
});

Deno.test("cleanup: remove auto-created test projects", async () => {
  for (const projectId of createdProjectIds) {
    await supabase.from("projects").delete().eq("id", projectId);
  }
  assertEquals(true, true); // Cleanup complete
});
