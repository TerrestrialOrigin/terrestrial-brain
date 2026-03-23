import { describe, it, expect, vi, beforeEach } from "vitest";

// Deno.env is read at module-level in project-extractor.ts, so stub before import
(globalThis as any).Deno = {
  env: {
    get: (key: string) => key === "OPENROUTER_API_KEY" ? "test-key" : undefined,
  },
};

// Dynamic import so the Deno stub is in place when the module evaluates
const {
  extractProjectFromConventionalPath,
  pathContainsProjectKeyword,
  extractProjectNameFromPath,
} = await import("./project-extractor");

// ─── extractProjectFromConventionalPath ─────────────────────────────────────

describe("extractProjectFromConventionalPath", () => {
  it("matches root-level projects folder", () => {
    expect(extractProjectFromConventionalPath("projects/CarChief/sprint-notes.md")).toBe("CarChief");
  });

  it("matches capitalized Projects folder", () => {
    expect(extractProjectFromConventionalPath("Projects/CarChief/sprint-notes.md")).toBe("CarChief");
  });

  it("matches PROJECTS in all caps", () => {
    expect(extractProjectFromConventionalPath("PROJECTS/CarChief/notes.md")).toBe("CarChief");
  });

  it("matches nested projects folder", () => {
    expect(extractProjectFromConventionalPath("farming/projects/Rabbit Hutch/plan.md")).toBe("Rabbit Hutch");
  });

  it("matches deeply nested with capitalization", () => {
    expect(extractProjectFromConventionalPath("work/clients/Projects/DealerPro/kickoff.md")).toBe("DealerPro");
  });

  it("extracts first segment after projects/", () => {
    expect(extractProjectFromConventionalPath("Projects/CarChief/sprints/week1.md")).toBe("CarChief");
  });

  it("returns null for no match", () => {
    expect(extractProjectFromConventionalPath("daily/2026-03-22.md")).toBeNull();
  });

  it("returns null for null referenceId", () => {
    expect(extractProjectFromConventionalPath(null)).toBeNull();
  });

  it("returns null for empty folder name (projects//file.md)", () => {
    expect(extractProjectFromConventionalPath("projects//somefile.md")).toBeNull();
  });

  it("returns null for projects folder with no subfolder", () => {
    expect(extractProjectFromConventionalPath("projects/file.md")).toBeNull();
  });
});

// ─── pathContainsProjectKeyword ─────────────────────────────────────────────

describe("pathContainsProjectKeyword", () => {
  it("returns true for folder containing 'Project'", () => {
    expect(pathContainsProjectKeyword("farming/Rabbit Hutch Project/Plan.md")).toBe(true);
  });

  it("returns true for filename containing 'Project'", () => {
    expect(pathContainsProjectKeyword("farming/Rabbit Hutch Project.md")).toBe(true);
  });

  it("returns true for 'project' (lowercase)", () => {
    expect(pathContainsProjectKeyword("farming/my project ideas.md")).toBe(true);
  });

  it("returns true for 'PROJECT' (uppercase)", () => {
    expect(pathContainsProjectKeyword("farming/BIG PROJECT/notes.md")).toBe(true);
  });

  it("returns false for path without 'project'", () => {
    expect(pathContainsProjectKeyword("daily/2026-03-22.md")).toBe(false);
  });

  it("returns false for null referenceId", () => {
    expect(pathContainsProjectKeyword(null)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(pathContainsProjectKeyword("")).toBe(false);
  });

  // Note: conventional "projects/" folder also returns true, but
  // the extractor checks Signal 1a first and skips 1b if it matches
  it("returns true for conventional projects folder path", () => {
    expect(pathContainsProjectKeyword("projects/CarChief/notes.md")).toBe(true);
  });
});

// ─── extractProjectNameFromPath (with mocked fetch) ─────────────────────────

describe("extractProjectNameFromPath", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch after each test
    globalThis.fetch = originalFetch;
  });

  function mockFetchResponse(responseBody: object) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify(responseBody),
              },
            },
          ],
        }),
    });
  }

  function mockFetchFailure(status = 500) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: () => Promise.resolve("Internal Server Error"),
    });
  }

  it("extracts project name from folder containing 'Project'", async () => {
    mockFetchResponse({ is_project: true, project_name: "Rabbit Hutch" });

    const result = await extractProjectNameFromPath("farming/Rabbit Hutch Project/Plan.md");

    expect(result.isProject).toBe(true);
    expect(result.projectName).toBe("Rabbit Hutch");
  });

  it("extracts project name from filename containing 'Project'", async () => {
    mockFetchResponse({ is_project: true, project_name: "Rabbit Hutch" });

    const result = await extractProjectNameFromPath("farming/Rabbit Hutch Project.md");

    expect(result.isProject).toBe(true);
    expect(result.projectName).toBe("Rabbit Hutch");
  });

  it("returns isProject=false for descriptive use of 'Project'", async () => {
    mockFetchResponse({ is_project: false, project_name: null });

    const result = await extractProjectNameFromPath("farming/Project Planning notes.md");

    expect(result.isProject).toBe(false);
    expect(result.projectName).toBeNull();
  });

  it("handles LLM failure gracefully", async () => {
    mockFetchFailure(500);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await extractProjectNameFromPath("farming/Rabbit Hutch Project.md");

    expect(result.isProject).toBe(false);
    expect(result.projectName).toBeNull();
    consoleSpy.mockRestore();
  });

  it("handles LLM returning empty project name", async () => {
    mockFetchResponse({ is_project: true, project_name: "" });

    const result = await extractProjectNameFromPath("farming/Test Project.md");

    expect(result.isProject).toBe(false);
    expect(result.projectName).toBeNull();
  });

  it("handles LLM network error gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await extractProjectNameFromPath("farming/Rabbit Hutch Project.md");

    expect(result.isProject).toBe(false);
    expect(result.projectName).toBeNull();
    consoleSpy.mockRestore();
  });

  it("sends correct path to LLM", async () => {
    mockFetchResponse({ is_project: true, project_name: "Test" });

    await extractProjectNameFromPath("some/path/Test Project.md");

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages[1].content).toBe("Path: some/path/Test Project.md");
  });
});
