import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractProjectFromConventionalPath,
  extractProjectNameFromPath,
  pathContainsProjectKeyword,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";

// Pure/deterministic project-extractor unit tests. The LLM path is exercised
// with a stubbed global fetch, so no network or real OpenRouter key is needed.
// Relocated from the in-source vitest file (Step 5 test-suite split); the old
// `(globalThis as any).Deno` shim is unnecessary under a native Deno runner.

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
    extractProjectFromConventionalPath("work/clients/Projects/DemoProj/kickoff.md"),
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
  assertEquals(extractProjectFromConventionalPath("projects//somefile.md"), null);
});

Deno.test("extractProjectFromConventionalPath: returns null for projects folder with no subfolder", () => {
  assertEquals(extractProjectFromConventionalPath("projects/file.md"), null);
});

// ─── pathContainsProjectKeyword ─────────────────────────────────────────────

Deno.test("pathContainsProjectKeyword: true for folder containing 'Project'", () => {
  assertEquals(pathContainsProjectKeyword("farming/Rabbit Hutch Project/Plan.md"), true);
});

Deno.test("pathContainsProjectKeyword: true for filename containing 'Project'", () => {
  assertEquals(pathContainsProjectKeyword("farming/Rabbit Hutch Project.md"), true);
});

Deno.test("pathContainsProjectKeyword: true for 'project' (lowercase)", () => {
  assertEquals(pathContainsProjectKeyword("farming/my project ideas.md"), true);
});

Deno.test("pathContainsProjectKeyword: true for 'PROJECT' (uppercase)", () => {
  assertEquals(pathContainsProjectKeyword("farming/BIG PROJECT/notes.md"), true);
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

// ─── extractProjectNameFromPath (with stubbed fetch) ────────────────────────

const originalFetch = globalThis.fetch;

/** Install a fake fetch that returns an OpenRouter-shaped JSON completion. */
function stubFetchResponse(responseBody: object): { calls: unknown[][] } {
  const calls: unknown[][] = [];
  globalThis.fetch = ((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: JSON.stringify(responseBody) } }],
        }),
    } as Response);
  }) as typeof fetch;
  return { calls };
}

function stubFetchFailure(status = 500): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: false,
      status,
      text: () => Promise.resolve("Internal Server Error"),
    } as Response)) as typeof fetch;
}

/** Run a test body with fetch stubbed and console.error silenced, then restore. */
async function withFetchStub(run: () => Promise<void>): Promise<void> {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
}

Deno.test("extractProjectNameFromPath: extracts project name from folder containing 'Project'", async () => {
  await withFetchStub(async () => {
    stubFetchResponse({ is_project: true, project_name: "Rabbit Hutch" });
    const result = await extractProjectNameFromPath("farming/Rabbit Hutch Project/Plan.md");
    assertEquals(result.isProject, true);
    assertEquals(result.projectName, "Rabbit Hutch");
  });
});

Deno.test("extractProjectNameFromPath: extracts project name from filename containing 'Project'", async () => {
  await withFetchStub(async () => {
    stubFetchResponse({ is_project: true, project_name: "Rabbit Hutch" });
    const result = await extractProjectNameFromPath("farming/Rabbit Hutch Project.md");
    assertEquals(result.isProject, true);
    assertEquals(result.projectName, "Rabbit Hutch");
  });
});

Deno.test("extractProjectNameFromPath: isProject=false for descriptive use of 'Project'", async () => {
  await withFetchStub(async () => {
    stubFetchResponse({ is_project: false, project_name: null });
    const result = await extractProjectNameFromPath("farming/Project Planning notes.md");
    assertEquals(result.isProject, false);
    assertEquals(result.projectName, null);
  });
});

Deno.test("extractProjectNameFromPath: handles LLM failure gracefully", async () => {
  await withFetchStub(async () => {
    stubFetchFailure(500);
    const result = await extractProjectNameFromPath("farming/Rabbit Hutch Project.md");
    assertEquals(result.isProject, false);
    assertEquals(result.projectName, null);
  });
});

Deno.test("extractProjectNameFromPath: handles LLM returning empty project name", async () => {
  await withFetchStub(async () => {
    stubFetchResponse({ is_project: true, project_name: "" });
    const result = await extractProjectNameFromPath("farming/Test Project.md");
    assertEquals(result.isProject, false);
    assertEquals(result.projectName, null);
  });
});

Deno.test("extractProjectNameFromPath: handles LLM network error gracefully", async () => {
  await withFetchStub(async () => {
    globalThis.fetch = (() => Promise.reject(new Error("Network error"))) as typeof fetch;
    const result = await extractProjectNameFromPath("farming/Rabbit Hutch Project.md");
    assertEquals(result.isProject, false);
    assertEquals(result.projectName, null);
  });
});

Deno.test("extractProjectNameFromPath: sends correct path to LLM", async () => {
  await withFetchStub(async () => {
    const stub = stubFetchResponse({ is_project: true, project_name: "Test" });
    await extractProjectNameFromPath("some/path/Test Project.md");
    const fetchCall = stub.calls[0];
    const body = JSON.parse((fetchCall[1] as { body: string }).body);
    assertEquals(body.messages[1].content, "Path: some/path/Test Project.md");
  });
});
