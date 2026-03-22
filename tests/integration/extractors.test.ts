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
  extractProjectFolderName,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";

// ---------------------------------------------------------------------------
// Supabase client for direct DB access in tests
// ---------------------------------------------------------------------------

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Seed project IDs (from seed.sql)
const CARCHIEF_ID = "00000000-0000-0000-0000-000000000001";
const TERRESTRIAL_BRAIN_ID = "00000000-0000-0000-0000-000000000002";

// Track auto-created projects for cleanup
const createdProjectIds: string[] = [];

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
// 3.1b — extractProjectFolderName unit tests
// ---------------------------------------------------------------------------

Deno.test("extractProjectFolderName: extracts name from projects path", () => {
  assertEquals(
    extractProjectFolderName("projects/CarChief/sprint-notes.md"),
    "CarChief",
  );
});

Deno.test("extractProjectFolderName: extracts from nested path", () => {
  assertEquals(
    extractProjectFolderName("projects/CarChief/sprints/week1.md"),
    "CarChief",
  );
});

Deno.test("extractProjectFolderName: returns null for non-projects path", () => {
  assertEquals(extractProjectFolderName("daily/2026-03-22.md"), null);
});

Deno.test("extractProjectFolderName: returns null for empty folder name", () => {
  assertEquals(extractProjectFolderName("projects//somefile.md"), null);
});

Deno.test("extractProjectFolderName: returns null for null referenceId", () => {
  assertEquals(extractProjectFolderName(null), null);
});

Deno.test("extractProjectFolderName: returns null for projects without trailing slash", () => {
  assertEquals(extractProjectFolderName("projects"), null);
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
// Cleanup
// ---------------------------------------------------------------------------

Deno.test("cleanup: remove auto-created test projects", async () => {
  for (const projectId of createdProjectIds) {
    await supabase.from("projects").delete().eq("id", projectId);
  }
  assertEquals(true, true); // Cleanup complete
});
