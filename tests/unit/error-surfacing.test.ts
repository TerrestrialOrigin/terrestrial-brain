import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  handleGetProject,
  handleListProjects,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/projects.ts";
import { handleGetPerson } from "../../supabase/functions/terrestrial-brain-mcp/tools/people.ts";
import {
  executeReconciliationPlan,
  touchRetrievedLogged,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts";
import { freshIngest } from "../../supabase/functions/terrestrial-brain-mcp/helpers.ts";
import {
  EXTRACTION_THREW_WARNING,
  runExtractionForTool,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import { parseNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import { FakeAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts";
import { SupabaseTaskRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-task-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";
import type {
  ProjectFullRow,
  ProjectListRow,
  ProjectRepository,
} from "../../supabase/functions/terrestrial-brain-mcp/repositories/project-repository.ts";
import type {
  PersonFullRow,
  PersonRepository,
} from "../../supabase/functions/terrestrial-brain-mcp/repositories/person-repository.ts";
import type { TaskRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/task-repository.ts";
import type { ThoughtRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/thought-repository.ts";
import type { RepoError } from "../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

// Step 16 (error-surfacing-sweep): a failed sub-lookup must render as visibly
// broken — never as a clean zero/empty — and every best-effort failure must
// leave a console.error trace (TOOL-4, TOOL-5, TOOL-12, TOOL-13, REPO-7).
// All fakes sit on the repository/provider seams only; the handlers under test
// run for real (mock-boundary rule).

const notImpl = () => Promise.reject(new Error("not implemented"));
const DB_ERROR: RepoError = { message: "db unavailable" };
const UNAVAILABLE_MARKER = "? (lookup failed)";

/** Runs `body` with console.error captured; returns the captured lines. */
async function withCapturedErrors(
  body: () => Promise<void>,
): Promise<string[]> {
  const original = console.error;
  const captured: string[] = [];
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    await body();
  } finally {
    console.error = original;
  }
  return captured;
}

/** Like `withCapturedErrors`, but also returns the body's resolved value. */
async function captureErrorsWithValue<Value>(
  body: () => Promise<Value>,
): Promise<{ value: Value; logs: string[] }> {
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const value = await body();
    return { value, logs };
  } finally {
    console.error = original;
  }
}

function resultText(
  result: { content: { type: "text"; text: string }[] },
): string {
  return result.content.map((part) => part.text).join("\n");
}

// ---------------------------------------------------------------------------
// Fakes (seam-level only)
// ---------------------------------------------------------------------------

function fakeProjectRepository(
  overrides: Partial<ProjectRepository>,
): ProjectRepository {
  return {
    insert: notImpl,
    list: notImpl,
    findById: notImpl,
    findName: notImpl,
    findByName: notImpl,
    listChildrenBasic: notImpl,
    listChildParentIds: notImpl,
    listActiveChildIds: notImpl,
    update: notImpl,
    archiveManyActive: notImpl,
    listActive: notImpl,
    ...overrides,
  };
}

function fakePersonRepository(
  overrides: Partial<PersonRepository>,
): PersonRepository {
  return {
    insert: notImpl,
    list: notImpl,
    findById: notImpl,
    findName: notImpl,
    findByName: notImpl,
    update: notImpl,
    archive: notImpl,
    listActive: notImpl,
    ...overrides,
  };
}

function fakeTaskRepository(
  overrides: Partial<TaskRepository>,
): TaskRepository {
  return {
    insert: notImpl,
    list: notImpl,
    listIncompleteUnarchived: notImpl,
    findByIds: notImpl,
    update: notImpl,
    archive: notImpl,
    archiveIfActive: notImpl,
    countOpenByProject: notImpl,
    countOpenByAssignee: notImpl,
    findOpenIdsByProjects: notImpl,
    archiveMany: notImpl,
    deleteByIds: notImpl,
    findByReference: notImpl,
    ...overrides,
  };
}

function fakeThoughtRepository(
  overrides: Partial<ThoughtRepository>,
): ThoughtRepository {
  return {
    matchByEmbedding: notImpl,
    list: notImpl,
    stats: notImpl,
    findById: notImpl,
    findForUpdate: notImpl,
    findActiveById: notImpl,
    findByReference: notImpl,
    findByContentHash: notImpl,
    findStale: notImpl,
    findArchivalCandidates: notImpl,
    setSupersededBy: notImpl,
    touchRetrieved: notImpl,
    insert: notImpl,
    update: notImpl,
    archive: notImpl,
    archiveByDocumentReference: notImpl,
    incrementUsefulness: notImpl,
    incrementUsefulnessWeighted: notImpl,
    deleteByNoteSnapshot: notImpl,
    ...overrides,
  };
}

function projectRow(overrides: Partial<ProjectFullRow> = {}): ProjectFullRow {
  return {
    id: "project-1",
    name: "Acme",
    type: "client",
    parent_id: null,
    description: null,
    metadata: null,
    content_hash: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

function personRow(overrides: Partial<PersonFullRow> = {}): PersonFullRow {
  return {
    id: "person-1",
    name: "Ann Smith",
    type: "human",
    email: null,
    description: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    archived_at: null,
    ...overrides,
  } as PersonFullRow;
}

// ---------------------------------------------------------------------------
// REPO-7 — count envelope keeps data null on error
// ---------------------------------------------------------------------------

Deno.test("countOpenByProject: query error yields data null, never 0", async () => {
  const { client } = makeFakeClient({
    count: null,
    error: { message: "count boom" },
  });
  const repo = new SupabaseTaskRepository(client);

  const { data, error } = await repo.countOpenByProject("project-1");

  assertEquals(data, null);
  assertEquals(error?.message, "count boom");
});

Deno.test("countOpenByAssignee: query error yields data null, never 0", async () => {
  const { client } = makeFakeClient({
    count: null,
    error: { message: "count boom" },
  });
  const repo = new SupabaseTaskRepository(client);

  const { data, error } = await repo.countOpenByAssignee("person-1");

  assertEquals(data, null);
  assertEquals(error?.message, "count boom");
});

Deno.test("countOpenByProject: zero-row success yields data 0, error null", async () => {
  const { client } = makeFakeClient({ count: 0 });
  const repo = new SupabaseTaskRepository(client);

  const { data, error } = await repo.countOpenByProject("project-1");

  assertEquals(data, 0);
  assertEquals(error, null);
});

// ---------------------------------------------------------------------------
// TOOL-4 — get_project / get_person / list_projects unavailable markers
// ---------------------------------------------------------------------------

Deno.test("handleGetProject: failed open-task count renders marker, not 0", async () => {
  const project = fakeProjectRepository({
    findById: () => Promise.resolve({ data: projectRow(), error: null }),
    listChildrenBasic: () => Promise.resolve({ data: [], error: null }),
  });
  const task = fakeTaskRepository({
    countOpenByProject: () => Promise.resolve({ data: null, error: DB_ERROR }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    text = resultText(await handleGetProject(project, task, "project-1"));
  });

  assertStringIncludes(text, `Open tasks: ${UNAVAILABLE_MARKER}`);
  assert(
    !text.includes("Open tasks: 0"),
    `a failed count must not render as 0, got: ${text}`,
  );
  assert(
    logs.some((line) => line.includes("db unavailable")),
    "the failed count must be logged via console.error",
  );
});

Deno.test("handleGetProject: failed parent-name lookup renders marker", async () => {
  const project = fakeProjectRepository({
    findById: () =>
      Promise.resolve({
        data: projectRow({ parent_id: "parent-1" }),
        error: null,
      }),
    findName: () => Promise.resolve({ data: null, error: DB_ERROR }),
    listChildrenBasic: () => Promise.resolve({ data: [], error: null }),
  });
  const task = fakeTaskRepository({
    countOpenByProject: () => Promise.resolve({ data: 2, error: null }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    text = resultText(await handleGetProject(project, task, "project-1"));
  });

  assertStringIncludes(text, `Parent: ${UNAVAILABLE_MARKER}`);
  assertStringIncludes(text, "Open tasks: 2");
  assert(logs.length > 0, "the failed parent lookup must be logged");
});

Deno.test("handleGetProject: failed children lookup renders marker", async () => {
  const project = fakeProjectRepository({
    findById: () => Promise.resolve({ data: projectRow(), error: null }),
    listChildrenBasic: () => Promise.resolve({ data: null, error: DB_ERROR }),
  });
  const task = fakeTaskRepository({
    countOpenByProject: () => Promise.resolve({ data: 0, error: null }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    text = resultText(await handleGetProject(project, task, "project-1"));
  });

  assertStringIncludes(text, `Children: ${UNAVAILABLE_MARKER}`);
  assert(logs.length > 0, "the failed children lookup must be logged");
});

Deno.test("handleGetProject: successful zero count renders 0 with no marker or log", async () => {
  const project = fakeProjectRepository({
    findById: () => Promise.resolve({ data: projectRow(), error: null }),
    listChildrenBasic: () => Promise.resolve({ data: [], error: null }),
  });
  const task = fakeTaskRepository({
    countOpenByProject: () => Promise.resolve({ data: 0, error: null }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    text = resultText(await handleGetProject(project, task, "project-1"));
  });

  assertStringIncludes(text, "Open tasks: 0");
  assert(!text.includes(UNAVAILABLE_MARKER), "success must not show a marker");
  assertEquals(logs, []);
});

Deno.test("handleGetPerson: failed assigned count renders marker, not 0", async () => {
  const person = fakePersonRepository({
    findById: () => Promise.resolve({ data: personRow(), error: null }),
  });
  const task = fakeTaskRepository({
    countOpenByAssignee: () => Promise.resolve({ data: null, error: DB_ERROR }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    text = resultText(await handleGetPerson(person, task, "person-1"));
  });

  assertStringIncludes(text, `Open tasks assigned: ${UNAVAILABLE_MARKER}`);
  assert(
    !text.includes("Open tasks assigned: 0"),
    `a failed count must not render as 0, got: ${text}`,
  );
  assert(
    logs.some((line) => line.includes("db unavailable")),
    "the failed count must be logged via console.error",
  );
});

Deno.test("handleGetPerson: successful zero count renders 0 with no marker", async () => {
  const person = fakePersonRepository({
    findById: () => Promise.resolve({ data: personRow(), error: null }),
  });
  const task = fakeTaskRepository({
    countOpenByAssignee: () => Promise.resolve({ data: 0, error: null }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    text = resultText(await handleGetPerson(person, task, "person-1"));
  });

  assertStringIncludes(text, "Open tasks assigned: 0");
  assert(!text.includes(UNAVAILABLE_MARKER), "success must not show a marker");
  assertEquals(logs, []);
});

Deno.test("handleListProjects: failed child-count lookup keeps listing, adds note", async () => {
  const rows: ProjectListRow[] = [
    {
      id: "project-1",
      name: "Acme",
      type: "client",
      parent_id: null,
      archived_at: null,
      created_at: "2026-07-01T00:00:00.000Z",
    },
  ];
  const project = fakeProjectRepository({
    list: () => Promise.resolve({ data: rows, error: null }),
    listChildParentIds: () => Promise.resolve({ data: null, error: DB_ERROR }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    text = resultText(
      await handleListProjects(
        project,
        () => Promise.resolve(new Map<string, string>()),
        { include_archived: false, limit: 10 },
      ),
    );
  });

  assertStringIncludes(text, "Acme");
  assertStringIncludes(text, "Child counts unavailable");
  assert(
    logs.some((line) => line.includes("db unavailable")),
    "the failed child-count lookup must be logged",
  );
});

Deno.test("handleListProjects: successful child-count lookup shows no note", async () => {
  const rows: ProjectListRow[] = [
    {
      id: "project-1",
      name: "Acme",
      type: "client",
      parent_id: null,
      archived_at: null,
      created_at: "2026-07-01T00:00:00.000Z",
    },
  ];
  const project = fakeProjectRepository({
    list: () => Promise.resolve({ data: rows, error: null }),
    listChildParentIds: () => Promise.resolve({ data: [], error: null }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    text = resultText(
      await handleListProjects(
        project,
        () => Promise.resolve(new Map<string, string>()),
        { include_archived: false, limit: 10 },
      ),
    );
  });

  assert(!text.includes("Child counts unavailable"));
  assertEquals(logs, []);
});

// ---------------------------------------------------------------------------
// TOOL-5 — touchRetrieved failures are logged, reads still succeed
// ---------------------------------------------------------------------------

Deno.test("touchRetrievedLogged: failure is logged with the site label and never throws", async () => {
  const repo = fakeThoughtRepository({
    touchRetrieved: () =>
      Promise.resolve({ data: null, error: { message: "touch boom" } }),
  });

  const logs = await withCapturedErrors(async () => {
    await touchRetrievedLogged(repo, ["thought-1"], "search_thoughts");
  });

  assert(
    logs.some((line) =>
      line.includes("touch boom") && line.includes("search_thoughts")
    ),
    `expected a logged touch failure with site label, got: ${
      JSON.stringify(logs)
    }`,
  );
});

Deno.test("touchRetrievedLogged: success logs nothing", async () => {
  const repo = fakeThoughtRepository({
    touchRetrieved: () => Promise.resolve({ data: null, error: null }),
  });

  const logs = await withCapturedErrors(async () => {
    await touchRetrievedLogged(repo, ["thought-1"], "list_thoughts");
  });

  assertEquals(logs, []);
});

// ---------------------------------------------------------------------------
// TOOL-12 — thrown extraction pipeline yields a visible warning
// ---------------------------------------------------------------------------

function extractionDeps() {
  return {
    supabase: makeFakeClient({ data: null }).client,
    aiProvider: new FakeAiProvider(),
    taskRepository: fakeTaskRepository({}),
    projectRepository: fakeProjectRepository({}),
    personRepository: fakePersonRepository({}),
  };
}

Deno.test("runExtractionForTool: a thrown pipeline returns the thrown warning and logs", async () => {
  const { value: outcome, logs } = await captureErrorsWithValue(() =>
    runExtractionForTool({
      parse: () => parseNote("hello", null, null, "mcp"),
      deps: extractionDeps(),
      site: "capture_thought",
      runPipeline: () => Promise.reject(new Error("pipeline exploded")),
    })
  );

  assertEquals(outcome.status, "completed");
  if (outcome.status === "completed") {
    assertEquals(outcome.warning, EXTRACTION_THREW_WARNING);
    assertEquals(outcome.references, {});
  }
  assert(
    logs.some((line) =>
      line.includes("capture_thought") && line.includes("pipeline exploded")
    ),
    `the throw must be logged with the site label, got: ${
      JSON.stringify(logs)
    }`,
  );
});

Deno.test("runExtractionForTool: thrownWarning/thrownReferences overrides are honored", async () => {
  const { value: outcome } = await captureErrorsWithValue(() =>
    runExtractionForTool({
      parse: () => parseNote("hello", null, null, "mcp"),
      deps: extractionDeps(),
      site: "update_document",
      thrownReferences: { people: [], tasks: [] },
      thrownWarning: " (warning: references reset to empty)",
      runPipeline: () => Promise.reject(new Error("boom")),
    })
  );

  assertEquals(outcome.status, "completed");
  if (outcome.status === "completed") {
    assertEquals(outcome.warning, " (warning: references reset to empty)");
    assertEquals(outcome.references, { people: [], tasks: [] });
  }
});

Deno.test("runExtractionForTool: seed-read failure maps to aborted", async () => {
  const outcome = await runExtractionForTool({
    parse: () => parseNote("hello", null, null, "mcp"),
    deps: extractionDeps(),
    site: "capture_thought",
    runPipeline: () =>
      Promise.resolve({ ok: false as const, error: "seed down" }),
  });

  assertEquals(outcome, { status: "aborted", reason: "seed down" });
});

Deno.test("runExtractionForTool: per-write errors surface as the partial warning", async () => {
  const outcome = await runExtractionForTool({
    parse: () => parseNote("hello", null, null, "mcp"),
    deps: extractionDeps(),
    site: "capture_thought",
    runPipeline: () =>
      Promise.resolve({
        ok: true as const,
        references: { tasks: ["task-1"] },
        errors: ["task write failed"],
      }),
  });

  assertEquals(outcome.status, "completed");
  if (outcome.status === "completed") {
    assertStringIncludes(outcome.warning, "task write failed");
    assertEquals(outcome.references, { tasks: ["task-1"] });
  }
});

Deno.test("runExtractionForTool: clean success carries an empty warning", async () => {
  const outcome = await runExtractionForTool({
    parse: () => parseNote("hello", null, null, "mcp"),
    deps: extractionDeps(),
    site: "capture_thought",
    runPipeline: () =>
      Promise.resolve({
        ok: true as const,
        references: { tasks: [] },
        errors: [],
      }),
  });

  assertEquals(outcome.status, "completed");
  if (outcome.status === "completed") {
    assertEquals(outcome.warning, "");
  }
});

// ---------------------------------------------------------------------------
// TOOL-13 — allSettled rejection reasons are logged
// ---------------------------------------------------------------------------

Deno.test("executeReconciliationPlan: a failed archive op logs its reason and still counts", async () => {
  const repo = fakeThoughtRepository({
    archive: () =>
      Promise.resolve({ data: null, error: { message: "archive exploded" } }),
  });

  let counts = { updated: 0, added: 0, deleted: 0, failures: 0, opsLength: 0 };
  const logs = await withCapturedErrors(async () => {
    counts = await executeReconciliationPlan(
      repo,
      new FakeAiProvider(),
      { keep: [], update: [], add: [], delete: ["thought-1"] },
      {
        noteSnapshotId: null,
        noteId: undefined,
        title: undefined,
        references: {},
      },
    );
  });

  assertEquals(counts.failures, 1);
  assertEquals(counts.deleted, 0);
  assert(
    logs.some((line) => line.includes("Archive failed for thought-1")),
    `the rejection reason must be logged, got: ${JSON.stringify(logs)}`,
  );
});

Deno.test("freshIngest: a failed thought insert logs its reason and still counts", async () => {
  const repo = fakeThoughtRepository({
    findByContentHash: () => Promise.resolve({ data: [], error: null }),
    matchByEmbedding: () => Promise.resolve({ data: [], error: null }),
    insert: () =>
      Promise.resolve({ data: null, error: { message: "insert exploded" } }),
  });

  let text = "";
  const logs = await withCapturedErrors(async () => {
    const result = await freshIngest(
      repo,
      new FakeAiProvider(),
      "One standalone thought",
      undefined,
      undefined,
    );
    text = result.content.map((part) => part.text).join("\n");
  });

  assertStringIncludes(text, "1 failed");
  assert(
    logs.some((line) => line.includes("insert exploded")),
    `the rejection reason must be logged, got: ${JSON.stringify(logs)}`,
  );
});
