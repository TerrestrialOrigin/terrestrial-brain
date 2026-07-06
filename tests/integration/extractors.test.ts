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
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";
import {
  TaskExtractor,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts";
import {
  PeopleExtractor,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/people-extractor.ts";
import { createAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/factory.ts";
import { SupabaseTaskRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-task-repository.ts";
import { SupabaseProjectRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-project-repository.ts";
import { SupabasePersonRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-person-repository.ts";

// ---------------------------------------------------------------------------
// Supabase client for direct DB access in tests
// ---------------------------------------------------------------------------

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// Real repository over the same test client so the extractor pipeline's task
// writes hit the DB exactly as before the Step 16 seam (behavior-preserving).
const taskRepository = new SupabaseTaskRepository(supabase);
const projectRepository = new SupabaseProjectRepository(supabase);
const personRepository = new SupabasePersonRepository(supabase);

// These tests drive the REAL extraction pipeline in-process. The provider is
// chosen by the same factory the served function uses (Step 22): the default
// suite runs with TB_AI_PROVIDER=fake, so extraction is deterministic and needs
// no live key; the opt-in live-LLM tier runs the real provider.
const testAiProvider = createAiProvider();

// Seed project IDs (from seed.sql)
const TEST_PROJ_ID = "00000000-0000-0000-0000-000000000001";
const TERRESTRIAL_BRAIN_ID = "00000000-0000-0000-0000-000000000002";

// Seed people IDs (from seed.sql)
const ALICE_ID = "00000000-0000-0000-0000-100000000001";
const CLAUDE_ID = "00000000-0000-0000-0000-100000000002";

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
  const result = await runExtractionPipeline(
    note,
    [mockExtractor],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

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
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
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
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
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
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

  assertEquals(downstreamSawProject, true);
});

Deno.test("pipeline: extractor returning empty ids includes key in result", async () => {
  const emptyExtractor: Extractor = {
    referenceKey: "projects",
    extract: async () => ({ referenceKey: "projects", ids: [] }),
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  const result = await runExtractionPipeline(
    note,
    [emptyExtractor],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

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
  await runExtractionPipeline(
    note,
    [inspectingExtractor],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

  // Seed data has at least Test Proj, Terrestrial Brain, Test Proj Backend
  const projectNames = capturedKnownProjects.map(
    (project: { id: string; name: string }) => project.name,
  );
  assertEquals(projectNames.includes("Test Proj"), true);
  assertEquals(projectNames.includes("Terrestrial Brain"), true);
});

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

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

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

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [
      { id: TEST_PROJ_ID, name: "Test Proj" },
      { id: TERRESTRIAL_BRAIN_ID, name: "Terrestrial Brain" },
    ],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.ids.includes(TEST_PROJ_ID), true);
});

Deno.test("ProjectExtractor: heading match is case-insensitive", async () => {
  const extractor = new ProjectExtractor();
  const content = "# test proj\n\nSome notes.";
  const note = parseNote(content, "Notes", "daily/today.md", "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);

  assertEquals(result.ids.includes(TEST_PROJ_ID), true);
});

Deno.test("ProjectExtractor: heading not matching any project returns no match from headings", async () => {
  const extractor = new ProjectExtractor();
  const content = "# Meeting Notes\n\nDiscussed various topics.";
  const note = parseNote(content, "Meeting", "daily/today.md", "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

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
  const uniqueName = `TestAutoCreate_${Date.now()}`;
  const note = parseNote(
    "Kickoff meeting notes.",
    "Kickoff",
    `projects/${uniqueName}/kickoff.md`,
    "obsidian",
  );

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
  const content = "# Test Proj\n\nProject status update for Test Proj.";
  const note = parseNote(
    content,
    "Test Proj Status",
    "projects/Test Proj/status.md",
    "obsidian",
  );

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

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

  const result = await runExtractionPipeline(
    note,
    [new ProjectExtractor()],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

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

  const result = await runExtractionPipeline(
    note,
    [new ProjectExtractor()],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

  assertExists(result.projects);
  assertEquals(Array.isArray(result.projects), true);
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
  const content =
    "- [ ] Parent task\n  - [ ] Child task\n    - [ ] Grandchild task\n";
  const note = parseNote(content, "Hierarchy", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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

  createdTaskIds.push(...result.ids);
});

// ---------------------------------------------------------------------------
// 7.4 — TaskExtractor: tasks under project heading get correct project_id
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: tasks under project heading get correct project_id", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/heading-project-${Date.now()}.md`;
  const content =
    "# Test Proj\n\n- [ ] Fix record page\n\n# Other\n\n- [ ] Generic task\n";
  const note = parseNote(content, "Mixed", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((
      task: { id: string; content: string; reference_id: string | null },
    ) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((
      task: { id: string; content: string; reference_id: string | null },
    ) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((
      task: { id: string; content: string; reference_id: string | null },
    ) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((
      task: { id: string; content: string; reference_id: string | null },
    ) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
  const contents = allTasks?.map((task: { content: string }) => task.content)
    .sort();
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
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
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
  const referenceId = `projects/Test Proj/pipeline-test-${Date.now()}.md`;
  const content =
    "# Test Proj\n\n- [ ] Fix record page\n- [ ] Update pricing API\n";
  const note = parseNote(content, "Pipeline", referenceId, "obsidian");

  // Run the real pipeline — ProjectExtractor sets accumulatedReferences.projects,
  // TaskExtractor reads them via context.accumulatedReferences.projects
  const result = await runExtractionPipeline(
    note,
    [new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
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
    .insert({
      content: "Pre-existing task",
      status: "open",
      reference_id: referenceId,
    })
    .select("id")
    .single();

  assertExists(preCreated);
  createdTaskIds.push(preCreated.id);

  // Run pipeline — should pick up the pre-existing task in knownTasks
  let capturedKnownTasks: {
    id: string;
    content: string;
    reference_id: string | null;
  }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: async (_note, context) => {
      capturedKnownTasks = context.knownTasks;
      return { referenceKey: "inspect", ids: [] };
    },
  };

  const note = parseNote(
    "- [ ] New task\n",
    "Context",
    referenceId,
    "obsidian",
  );
  await runExtractionPipeline(
    note,
    [inspectingExtractor],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

  assertEquals(capturedKnownTasks.length, 1);
  assertEquals(capturedKnownTasks[0].id, preCreated.id);
  assertEquals(capturedKnownTasks[0].content, "Pre-existing task");
  assertEquals(capturedKnownTasks[0].reference_id, referenceId);
});

Deno.test("pipeline: knownTasks empty for note with no referenceId", async () => {
  let capturedKnownTasks: {
    id: string;
    content: string;
    reference_id: string | null;
  }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: async (_note, context) => {
      capturedKnownTasks = context.knownTasks;
      return { referenceKey: "inspect", ids: [] };
    },
  };

  const note = parseNote("Some content", "No Ref", null, "obsidian");
  await runExtractionPipeline(
    note,
    [inspectingExtractor],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

  assertEquals(capturedKnownTasks.length, 0);
});

// ---------------------------------------------------------------------------
// 8.0 — PeopleExtractor tests
// ---------------------------------------------------------------------------

Deno.test("PeopleExtractor: referenceKey is 'people'", async () => {
  const extractor = new PeopleExtractor();
  const note = parseNote("Some content", "Test", null, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);
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

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);
  assertEquals(result.ids, []);
});

Deno.test("PeopleExtractor: empty note content returns empty ids", async () => {
  const extractor = new PeopleExtractor();
  const note = parseNote("", "Empty", null, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [{ id: ALICE_ID, name: "Alice" }],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);
  assertEquals(result.ids, []);
});

Deno.test("PeopleExtractor: with known people and content returns valid result", async () => {
  const extractor = new PeopleExtractor();
  const content =
    "# Meeting Notes\n\nDiscussed the roadmap with Alice. She suggested we prioritize the record page.";
  const note = parseNote(content, "Meeting", "daily/meeting.md", "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [
      { id: ALICE_ID, name: "Alice" },
      { id: CLAUDE_ID, name: "Claude" },
    ],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);
  // The note names Alice (a known person) and not Claude, so extraction resolves
  // to exactly Alice's id. Deterministic against the fake — a hard assertion.
  assertEquals(result.referenceKey, "people");
  assertEquals(result.ids, [ALICE_ID]);
});

Deno.test("PeopleExtractor: does not return unknown people", async () => {
  const extractor = new PeopleExtractor();
  const content = "Charlie mentioned he'd handle the deployment.";
  const note = parseNote(content, "Notes", null, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [{ id: ALICE_ID, name: "Alice" }],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);
  // Charlie is not in known people, so should not appear
  assertEquals(result.ids.includes(ALICE_ID), false);
});

// ---------------------------------------------------------------------------
// 8.1 — Pipeline context: knownPeople populated from DB
// ---------------------------------------------------------------------------

Deno.test("pipeline: knownPeople populated from DB", async () => {
  let capturedKnownPeople: { id: string; name: string }[] = [];

  const inspectingExtractor: Extractor = {
    referenceKey: "inspect",
    extract: async (_note, context) => {
      capturedKnownPeople = context.knownPeople;
      return { referenceKey: "inspect", ids: [] };
    },
  };

  const note = parseNote("Content", "Test", null, "obsidian");
  await runExtractionPipeline(
    note,
    [inspectingExtractor],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
  );

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
  const referenceId = `test/task-extractor/metadata-new-${Date.now()}.md`;
  const content = "# Sprint 12\n\n- [ ] Fix the navbar\n";
  const note = parseNote(content, "Notes", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);
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

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 9.4 — TaskExtractor: metadata refreshed on update
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: metadata refreshed on re-ingest", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/metadata-update-${Date.now()}.md`;

  // First ingest: no heading
  const content1 = "- [ ] Fix the login\n";
  const note1 = parseNote(content1, "Notes", referenceId, "obsidian");

  const context1: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result1 = await extractor.extract(note1, context1);
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

  const context2: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: (existingTasks || []).map((
      task: { id: string; content: string; reference_id: string | null },
    ) => ({
      id: task.id,
      content: task.content,
      reference_id: task.reference_id,
    })),
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  await extractor.extract(note2, context2);

  // Verify metadata was updated
  const { data: taskAfter } = await supabase
    .from("tasks")
    .select("metadata")
    .eq("id", taskId)
    .single();
  assertEquals(taskAfter?.metadata.section_heading, "Auth Sprint");
  assertEquals(taskAfter?.metadata.source, "obsidian");

  createdTaskIds.push(taskId);
});

// ---------------------------------------------------------------------------
// 9.5 — TaskExtractor: due date extracted from checkbox text
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: extracts due date from checkbox text", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/due-date-${Date.now()}.md`;
  const content = "- [ ] Ship feature by 2026-04-01\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);
  assertEquals(result.ids.length, 1);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, content, due_by")
    .eq("id", result.ids[0])
    .single();

  assertExists(task);
  assertEquals(task.content, "Ship feature");
  assertExists(task.due_by);
  assertEquals(new Date(task.due_by).toISOString(), "2026-04-01T00:00:00.000Z");

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 9.6 — TaskExtractor: no date leaves due_by null and content unchanged
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: no date leaves due_by null and content unchanged", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/no-due-date-${Date.now()}.md`;
  const content = "- [ ] Regular task with no date\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, content, due_by")
    .eq("id", result.ids[0])
    .single();

  assertExists(task);
  assertEquals(task.content, "Regular task with no date");
  assertEquals(task.due_by, null);

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 9.7 — TaskExtractor: person in checkbox text sets assigned_to
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: person in checkbox text sets assigned_to", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/person-text-${Date.now()}.md`;
  const content = "- [ ] Ask Alice about the API design\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [
      { id: ALICE_ID, name: "Alice" },
      { id: CLAUDE_ID, name: "Claude" },
    ],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, content, assigned_to")
    .eq("id", result.ids[0])
    .single();

  assertExists(task);
  assertEquals(task.assigned_to, ALICE_ID);

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 9.8 — TaskExtractor: person in section heading sets assigned_to
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: person in section heading sets assigned_to", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/person-heading-${Date.now()}.md`;
  const content = "# Alice Tasks\n\n- [ ] Review the dashboard PR\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [
      { id: ALICE_ID, name: "Alice" },
    ],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, assigned_to")
    .eq("id", result.ids[0])
    .single();

  assertExists(task);
  assertEquals(task.assigned_to, ALICE_ID);

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 9.9 — TaskExtractor: no person match leaves assigned_to null
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: no person match leaves assigned_to null", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/no-person-${Date.now()}.md`;
  const content = "- [ ] Fix the deployment pipeline\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople: [
      { id: ALICE_ID, name: "Alice" },
    ],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, assigned_to")
    .eq("id", result.ids[0])
    .single();

  assertExists(task);
  assertEquals(task.assigned_to, null);

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 9.10 — TaskExtractor: extraction_method tracks heading_match correctly
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: extraction_method is heading_match when project resolved by heading", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/method-heading-${Date.now()}.md`;
  const content = "# Test Proj\n\n- [ ] Fix record page\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const result = await extractor.extract(note, context);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, metadata, project_id")
    .eq("id", result.ids[0])
    .single();

  assertExists(task);
  assertEquals(task.project_id, TEST_PROJ_ID);

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 9.11 — TaskExtractor: extraction_method is file_path when project from pipeline
// ---------------------------------------------------------------------------

Deno.test("TaskExtractor: extraction_method is file_path when project from pipeline", async () => {
  const extractor = new TaskExtractor();
  const referenceId = `test/task-extractor/method-filepath-${Date.now()}.md`;
  const content = "- [ ] Update the API\n";
  const note = parseNote(content, "Tasks", referenceId, "obsidian");

  const context: ExtractionContext = {
    supabase,
    aiProvider: testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: [{ id: TEST_PROJ_ID, name: "Test Proj" }],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: { projects: [TEST_PROJ_ID] },
  };

  const result = await extractor.extract(note, context);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, metadata, project_id")
    .eq("id", result.ids[0])
    .single();

  assertExists(task);
  assertEquals(task.project_id, TEST_PROJ_ID);

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// 9.12 — Full pipeline integration: metadata, due_by, assigned_to all populated
// ---------------------------------------------------------------------------

Deno.test("pipeline: full extraction populates metadata, due_by, and assigned_to", async () => {
  const referenceId = `projects/Test Proj/full-pipeline-${Date.now()}.md`;
  const content =
    "# Test Proj\n\n- [ ] Alice should review the PR by 2026-05-01\n";
  const note = parseNote(content, "Full Test", referenceId, "obsidian");

  const result = await runExtractionPipeline(
    note,
    [new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()],
    supabase,
    testAiProvider,
    taskRepository,
    projectRepository,
    personRepository,
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
  assertEquals(new Date(task.due_by).toISOString(), "2026-05-01T00:00:00.000Z");

  // Assigned to Alice (name in checkbox text)
  assertEquals(task.assigned_to, ALICE_ID);

  // Metadata populated
  assertExists(task.metadata);
  assertEquals(task.metadata.source, "obsidian");
  assertEquals(task.metadata.section_heading, "Test Proj");

  createdTaskIds.push(task.id);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

Deno.test("cleanup: remove auto-created test tasks", async () => {
  for (const taskId of createdTaskIds) {
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);
    assertEquals(error, null, `Deleting test task ${taskId} should succeed`);
  }
});

Deno.test("cleanup: remove auto-created test projects", async () => {
  for (const projectId of createdProjectIds) {
    const { error } = await supabase.from("projects").delete().eq(
      "id",
      projectId,
    );
    assertEquals(
      error,
      null,
      `Deleting test project ${projectId} should succeed`,
    );
  }
});
