import { assertEquals } from "@std/assert";
import {
  extractProjectFromConventionalPath,
  extractProjectNameFromPath,
  pathContainsProjectKeyword,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";
import type {
  AiJsonCompletionRequest,
  AiProvider,
} from "../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";
import {
  AiProviderHttpError,
  AiProviderParseError,
} from "../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";

// Pure/deterministic project-extractor unit tests. The LLM path is exercised
// through a hand-written FakeAiProvider injected into the extractor — NO network,
// NO real OpenRouter key, NO fetch stub (Step 15's seam demonstration). This is
// the seam Step 22's stub plugs into; deleting the `completeJson` call in
// `extractProjectNameFromPath` reddens these tests (GATE 2b).
// Relocated from the in-source vitest file (Step 5 test-suite split).

/**
 * Deterministic fake AiProvider. `completeJson` feeds a canned raw object through
 * the caller's own parse callback (so the extractor's validation logic still runs),
 * or rejects with a typed error to exercise the fallback branches.
 */
class FakeAiProvider implements AiProvider {
  lastRequest: AiJsonCompletionRequest | null = null;

  constructor(
    private readonly outcome:
      | { kind: "ok"; raw: unknown }
      | { kind: "httpError" }
      | { kind: "parseError" }
      | { kind: "network" },
  ) {}

  getEmbedding(): Promise<number[]> {
    return Promise.resolve([]);
  }

  completeJson<Parsed>(
    request: AiJsonCompletionRequest,
    parse: (raw: unknown) => Parsed,
  ): Promise<Parsed> {
    this.lastRequest = request;
    switch (this.outcome.kind) {
      case "httpError":
        return Promise.reject(
          new AiProviderHttpError("fake", 500, "boom"),
        );
      case "parseError":
        return Promise.reject(new AiProviderParseError("fake", "bad json"));
      case "network":
        return Promise.reject(new Error("Network error"));
      case "ok":
        return Promise.resolve(parse(this.outcome.raw));
    }
  }
}

// ─── extractProjectFromConventionalPath ─────────────────────────────────────

Deno.test("extractProjectFromConventionalPath: matches root-level projects folder", () => {
  assertEquals(
    extractProjectFromConventionalPath("projects/Test Proj/sprint-notes.md"),
    "Test Proj",
  );
});

Deno.test("extractProjectFromConventionalPath: matches capitalized Projects folder", () => {
  assertEquals(
    extractProjectFromConventionalPath("Projects/Test Proj/sprint-notes.md"),
    "Test Proj",
  );
});

Deno.test("extractProjectFromConventionalPath: matches PROJECTS in all caps", () => {
  assertEquals(
    extractProjectFromConventionalPath("PROJECTS/Test Proj/notes.md"),
    "Test Proj",
  );
});

Deno.test("extractProjectFromConventionalPath: matches nested projects folder", () => {
  assertEquals(
    extractProjectFromConventionalPath("farming/projects/Rabbit Hutch/plan.md"),
    "Rabbit Hutch",
  );
});

Deno.test("extractProjectFromConventionalPath: matches deeply nested with capitalization", () => {
  assertEquals(
    extractProjectFromConventionalPath(
      "work/clients/Projects/DemoProj/kickoff.md",
    ),
    "DemoProj",
  );
});

Deno.test("extractProjectFromConventionalPath: extracts first segment after projects/", () => {
  assertEquals(
    extractProjectFromConventionalPath("Projects/Test Proj/sprints/week1.md"),
    "Test Proj",
  );
});

Deno.test("extractProjectFromConventionalPath: returns null for no match", () => {
  assertEquals(extractProjectFromConventionalPath("daily/2026-03-22.md"), null);
});

Deno.test("extractProjectFromConventionalPath: returns null for null referenceId", () => {
  assertEquals(extractProjectFromConventionalPath(null), null);
});

Deno.test("extractProjectFromConventionalPath: returns null for empty folder name (projects//file.md)", () => {
  assertEquals(
    extractProjectFromConventionalPath("projects//somefile.md"),
    null,
  );
});

Deno.test("extractProjectFromConventionalPath: returns null for projects folder with no subfolder", () => {
  assertEquals(extractProjectFromConventionalPath("projects/file.md"), null);
});

// ─── pathContainsProjectKeyword ─────────────────────────────────────────────

Deno.test("pathContainsProjectKeyword: true for folder containing 'Project'", () => {
  assertEquals(
    pathContainsProjectKeyword("farming/Rabbit Hutch Project/Plan.md"),
    true,
  );
});

Deno.test("pathContainsProjectKeyword: true for filename containing 'Project'", () => {
  assertEquals(
    pathContainsProjectKeyword("farming/Rabbit Hutch Project.md"),
    true,
  );
});

Deno.test("pathContainsProjectKeyword: true for 'project' (lowercase)", () => {
  assertEquals(pathContainsProjectKeyword("farming/my project ideas.md"), true);
});

Deno.test("pathContainsProjectKeyword: true for 'PROJECT' (uppercase)", () => {
  assertEquals(
    pathContainsProjectKeyword("farming/BIG PROJECT/notes.md"),
    true,
  );
});

Deno.test("pathContainsProjectKeyword: false for path without 'project'", () => {
  assertEquals(pathContainsProjectKeyword("daily/2026-03-22.md"), false);
});

Deno.test("pathContainsProjectKeyword: false for null referenceId", () => {
  assertEquals(pathContainsProjectKeyword(null), false);
});

Deno.test("pathContainsProjectKeyword: false for empty string", () => {
  assertEquals(pathContainsProjectKeyword(""), false);
});

Deno.test("pathContainsProjectKeyword: true for conventional projects folder path", () => {
  // The conventional "projects/" folder also returns true, but the extractor
  // checks Signal 1a first and skips 1b if it matches.
  assertEquals(pathContainsProjectKeyword("projects/Test Proj/notes.md"), true);
});

// ─── extractProjectNameFromPath (via injected FakeAiProvider) ───────────────

/** Silence the extractor's console.error during fallback-branch tests. */
async function quietly(run: () => Promise<void>): Promise<void> {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    console.error = originalConsoleError;
  }
}

Deno.test("extractProjectNameFromPath: extracts project name from folder containing 'Project'", async () => {
  const provider = new FakeAiProvider({
    kind: "ok",
    raw: { is_project: true, project_name: "Rabbit Hutch" },
  });
  const result = await extractProjectNameFromPath(
    "farming/Rabbit Hutch Project/Plan.md",
    provider,
  );
  assertEquals(result.isProject, true);
  assertEquals(result.projectName, "Rabbit Hutch");
});

Deno.test("extractProjectNameFromPath: extracts project name from filename containing 'Project'", async () => {
  const provider = new FakeAiProvider({
    kind: "ok",
    raw: { is_project: true, project_name: "Rabbit Hutch" },
  });
  const result = await extractProjectNameFromPath(
    "farming/Rabbit Hutch Project.md",
    provider,
  );
  assertEquals(result.isProject, true);
  assertEquals(result.projectName, "Rabbit Hutch");
});

Deno.test("extractProjectNameFromPath: isProject=false for descriptive use of 'Project'", async () => {
  const provider = new FakeAiProvider({
    kind: "ok",
    raw: { is_project: false, project_name: null },
  });
  const result = await extractProjectNameFromPath(
    "farming/Project Planning notes.md",
    provider,
  );
  assertEquals(result.isProject, false);
  assertEquals(result.projectName, null);
});

Deno.test("extractProjectNameFromPath: handles LLM HTTP failure gracefully", async () => {
  await quietly(async () => {
    const provider = new FakeAiProvider({ kind: "httpError" });
    const result = await extractProjectNameFromPath(
      "farming/Rabbit Hutch Project.md",
      provider,
    );
    assertEquals(result.isProject, false);
    assertEquals(result.projectName, null);
  });
});

Deno.test("extractProjectNameFromPath: handles LLM returning empty project name", async () => {
  const provider = new FakeAiProvider({
    kind: "ok",
    raw: { is_project: true, project_name: "" },
  });
  const result = await extractProjectNameFromPath(
    "farming/Test Project.md",
    provider,
  );
  assertEquals(result.isProject, false);
  assertEquals(result.projectName, null);
});

Deno.test("extractProjectNameFromPath: handles LLM network error gracefully", async () => {
  await quietly(async () => {
    const provider = new FakeAiProvider({ kind: "network" });
    const result = await extractProjectNameFromPath(
      "farming/Rabbit Hutch Project.md",
      provider,
    );
    assertEquals(result.isProject, false);
    assertEquals(result.projectName, null);
  });
});

Deno.test("extractProjectNameFromPath: sends correct path to the provider", async () => {
  const provider = new FakeAiProvider({
    kind: "ok",
    raw: { is_project: true, project_name: "Test" },
  });
  await extractProjectNameFromPath("some/path/Test Project.md", provider);
  assertEquals(
    provider.lastRequest?.userContent,
    "Path: some/path/Test Project.md",
  );
});

// ---------------------------------------------------------------------------
// EXTR-6 — ProjectExtractor auto-create failures are RETURNED in result.errors
// (failing-first). Uses the shared extraction fakes to drive the real
// ProjectExtractor.extract with a conventional project path.
// ---------------------------------------------------------------------------

import {
  assertExists as assertExistsExtr6,
  assertStringIncludes as assertStringIncludesExtr6,
} from "@std/assert";
import { ProjectExtractor } from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";
import { parseNote as parseNoteExtr6 } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import type { ExtractionContext as ExtractionContextExtr6 } from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import {
  FakeAiProvider as SharedFakeAiProvider,
  FakePersonRepository as SharedFakePersonRepository,
  FakeProjectRepository as SharedFakeProjectRepository,
  FakeTaskRepository as SharedFakeTaskRepository,
} from "./fakes/extraction-fakes.ts";

Deno.test("ProjectExtractor: auto-create failure is reported in result.errors", async () => {
  // A conventional project path -> matchOrCreateProject("Acme") for a NEW project.
  const note = parseNoteExtr6(
    "Some content",
    "Note",
    "projects/Acme/note.md",
    "obsidian",
  );
  const projectRepository = new SharedFakeProjectRepository();
  projectRepository.insert = () =>
    Promise.resolve({ data: null, error: { message: "rls denied" } });

  const context: ExtractionContextExtr6 = {
    aiProvider: new SharedFakeAiProvider(() => ({})),
    taskRepository: new SharedFakeTaskRepository(),
    projectRepository,
    personRepository: new SharedFakePersonRepository(),
    timeZone: "UTC",
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  const originalError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await new ProjectExtractor().extract(note, context);
  } finally {
    console.error = originalError;
  }

  assertEquals(result.ids, []);
  assertExistsExtr6(result.errors);
  assertStringIncludesExtr6(result.errors[0], "Acme");
  assertStringIncludesExtr6(result.errors[0], "rls denied");
});

// ---------------------------------------------------------------------------
// EXTR-7 — a concurrent auto-create that loses the unique active-name race
// (23505) recovers the winner's id via findByName instead of creating a dup /
// dropping the reference.
// ---------------------------------------------------------------------------

function conventionalPathContext(
  projectRepository: SharedFakeProjectRepository,
): ExtractionContextExtr6 {
  return {
    aiProvider: new SharedFakeAiProvider(() => ({})),
    taskRepository: new SharedFakeTaskRepository(),
    projectRepository,
    personRepository: new SharedFakePersonRepository(),
    timeZone: "UTC",
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };
}

Deno.test("ProjectExtractor: 23505 name collision recovers the existing id", async () => {
  const note = parseNoteExtr6(
    "Some content",
    "Note",
    "projects/Acme/note.md",
    "obsidian",
  );
  const projectRepository = new SharedFakeProjectRepository();
  // A concurrent ingest already created active "Acme"; our insert loses.
  projectRepository.collideOn.add("Acme");
  projectRepository.existingByName.set("Acme", {
    id: "existing-acme-id",
    name: "Acme",
  });

  const result = await new ProjectExtractor().extract(
    note,
    conventionalPathContext(projectRepository),
  );

  assertEquals(result.ids, ["existing-acme-id"], "recovers the winner's id");
  assertEquals(result.errors, undefined, "a recovered race is not an error");
  assertEquals(
    projectRepository.inserted.length,
    0,
    "no duplicate row is created on the losing side",
  );
});

Deno.test("ProjectExtractor: 23505 with a failed recovery lookup is reported, not dropped silently", async () => {
  const note = parseNoteExtr6(
    "Some content",
    "Note",
    "projects/Acme/note.md",
    "obsidian",
  );
  const projectRepository = new SharedFakeProjectRepository();
  projectRepository.collideOn.add("Acme");
  projectRepository.findByNameError = "lookup boom";

  const originalError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await new ProjectExtractor().extract(
      note,
      conventionalPathContext(projectRepository),
    );
  } finally {
    console.error = originalError;
  }

  assertEquals(result.ids, []);
  assertExistsExtr6(result.errors);
  assertStringIncludesExtr6(result.errors[0], "Acme");
});
