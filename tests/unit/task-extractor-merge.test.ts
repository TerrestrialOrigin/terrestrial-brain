import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TaskExtractor } from "../../supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts";
import type {
  ExtractionContext,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import { OpenRouterAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/openrouter-provider.ts";
import type {
  ParsedCheckbox,
  ParsedNote,
} from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import type {
  NewTaskValues,
  TaskRepository,
} from "../../supabase/functions/terrestrial-brain-mcp/repositories/task-repository.ts";
import type { ProjectRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/project-repository.ts";
import type { PersonRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/person-repository.ts";

// TaskExtractor never touches the project/person repositories — these stubs only
// satisfy the ExtractionContext shape (fix-plan Step 17).
const STUB_PROJECT_REPOSITORY: ProjectRepository = {
  insert: () => Promise.reject(new Error("unused in these tests")),
  list: () => Promise.reject(new Error("unused")),
  findById: () => Promise.reject(new Error("unused")),
  findName: () => Promise.reject(new Error("unused")),
  listChildrenBasic: () => Promise.reject(new Error("unused")),
  listChildParentIds: () => Promise.reject(new Error("unused")),
  listActiveChildIds: () => Promise.reject(new Error("unused")),
  update: () => Promise.reject(new Error("unused")),
  archiveManyActive: () => Promise.reject(new Error("unused")),
  listActive: () => Promise.reject(new Error("unused")),
};

const STUB_PERSON_REPOSITORY: PersonRepository = {
  insert: () => Promise.reject(new Error("unused in these tests")),
  list: () => Promise.reject(new Error("unused")),
  findById: () => Promise.reject(new Error("unused")),
  findName: () => Promise.reject(new Error("unused")),
  update: () => Promise.reject(new Error("unused")),
  archive: () => Promise.reject(new Error("unused")),
  listActive: () => Promise.reject(new Error("unused")),
};

// Unit tests for TaskExtractor re-ingest MERGE SEMANTICS (finding C6, Step 8).
// Drives the REAL TaskExtractor.extract against a fake Supabase context and a
// stubbed global fetch — no DB, no network, no real OpenRouter key. A throwaway
// key must be present so the fail-fast `requireEnv` guard (Step 10) passes
// before the stubbed fetch is reached.

Deno.env.set("OPENROUTER_API_KEY", "test-openrouter-key");

const NOTE_REF = "notes/re-ingest.md";

// ---------------------------------------------------------------------------
// Fake TaskRepository: records the writes TaskExtractor issues (through the
// Step 16 repository seam) and can be told to fail them. The recorded
// WriteRecord shape mirrors the pre-seam Supabase chain 1:1, so the assertions
// below are unchanged:
//   update(id, payload)      → { op:"update", filters:{ id } }
//   insert(values)           → { op:"insert", filters:{} } → { data:{id,content} }
//   archiveIfActive(id)      → { op:"update", payload:{archived_at,status},
//                                filters:{ id, archived_at:null } }
// ---------------------------------------------------------------------------

interface WriteRecord {
  table: string;
  op: "update" | "insert";
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
}

interface FakeRepoOptions {
  /** Return an error message for a given update write, or null to succeed. */
  updateError?: (record: WriteRecord) => string | null;
  /** Error message for insert writes, or null (default) to succeed. */
  insertError?: string | null;
}

// The extractor never reads through context.supabase after the seam, so a bare
// stand-in satisfies the ExtractionContext type without being called.
const DUMMY_SUPABASE = {} as unknown as SupabaseClient;

function makeFakeTaskRepository(
  options: FakeRepoOptions = {},
): { taskRepository: TaskRepository; writes: WriteRecord[] } {
  const writes: WriteRecord[] = [];
  let insertCounter = 0;

  const taskRepository: TaskRepository = {
    insert(values: NewTaskValues) {
      const record: WriteRecord = {
        table: "tasks",
        op: "insert",
        payload: { ...values },
        filters: {},
      };
      writes.push(record);
      const errorMessage = options.insertError ?? null;
      if (errorMessage) {
        return Promise.resolve({
          data: null,
          error: { message: errorMessage },
        });
      }
      return Promise.resolve({
        data: {
          id: `new-task-${++insertCounter}`,
          content: String(values.content ?? ""),
        },
        error: null,
      });
    },
    update(id: string, updates: Record<string, unknown>) {
      const record: WriteRecord = {
        table: "tasks",
        op: "update",
        payload: updates,
        filters: { id },
      };
      writes.push(record);
      const errorMessage = options.updateError?.(record) ?? null;
      return Promise.resolve({
        data: null,
        error: errorMessage ? { message: errorMessage } : null,
      });
    },
    archive(id: string) {
      const record: WriteRecord = {
        table: "tasks",
        op: "update",
        payload: { archived_at: new Date().toISOString() },
        filters: { id },
      };
      writes.push(record);
      return Promise.resolve({ data: null, error: null });
    },
    archiveIfActive(id: string) {
      const record: WriteRecord = {
        table: "tasks",
        op: "update",
        payload: { archived_at: new Date().toISOString(), status: "done" },
        filters: { id, archived_at: null },
      };
      writes.push(record);
      const errorMessage = options.updateError?.(record) ?? null;
      return Promise.resolve({
        data: null,
        error: errorMessage ? { message: errorMessage } : null,
      });
    },
    list() {
      return Promise.resolve({ data: [], error: null });
    },
    findByIds() {
      return Promise.resolve({ data: [], error: null });
    },
    countOpenByProject() {
      return Promise.resolve({ data: 0, error: null });
    },
    countOpenByAssignee() {
      return Promise.resolve({ data: 0, error: null });
    },
    findOpenIdsByProjects() {
      return Promise.resolve({ data: [], error: null });
    },
    archiveMany() {
      return Promise.resolve({ data: null, error: null });
    },
    deleteByIds() {
      return Promise.resolve({ data: null, error: null });
    },
    findByReference() {
      return Promise.resolve({ data: [], error: null });
    },
  };

  return { taskRepository, writes };
}

// ---------------------------------------------------------------------------
// Fetch stubbing (mirrors tests/unit/project-extractor.test.ts).
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

/** Stub fetch to return an OK OpenRouter-shaped JSON body for every call. */
function stubFetchOk(responseBody: object): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: JSON.stringify(responseBody) } }],
        }),
    } as Response)) as typeof fetch;
}

/** Stub fetch to fail (non-OK) for every call — simulates LLM outage. */
function stubFetchFailure(status = 500): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: false,
      status,
      text: () => Promise.resolve("Internal Server Error"),
    } as Response)) as typeof fetch;
}

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MATCHED_TASK_ID = "00000000-0000-0000-0000-0000000000aa";

function checkbox(
  text: string,
  overrides: Partial<ParsedCheckbox> = {},
): ParsedCheckbox {
  return {
    text,
    checked: false,
    depth: 0,
    lineNumber: 1,
    parentIndex: null,
    sectionHeading: null,
    ...overrides,
  };
}

function note(checkboxes: ParsedCheckbox[]): ParsedNote {
  return {
    content: checkboxes.map((box) => `- [ ] ${box.text}`).join("\n"),
    title: "Re-ingest",
    referenceId: NOTE_REF,
    source: "obsidian",
    checkboxes,
    headings: [],
  };
}

function baseContext(
  taskRepository: TaskRepository,
  overrides: Partial<ExtractionContext> = {},
): ExtractionContext {
  return {
    supabase: DUMMY_SUPABASE,
    taskRepository,
    projectRepository: STUB_PROJECT_REPOSITORY,
    personRepository: STUB_PERSON_REPOSITORY,
    // The extractor reaches the LLM through this seam (Step 15). The real
    // OpenRouter provider calls globalThis.fetch, which these tests stub — so an
    // HTTP-500 stub surfaces as a provider error the extractor catches (preserve
    // path), and a canned stub response feeds the extractor's parse/validate.
    aiProvider: new OpenRouterAiProvider(),
    knownProjects: [],
    knownTasks: [
      {
        id: MATCHED_TASK_ID,
        content: "Fix the login page",
        reference_id: NOTE_REF,
      },
    ],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
    ...overrides,
  };
}

/** The single matched-task update write (op=update, filter id = matched task). */
function matchedUpdate(writes: WriteRecord[]): WriteRecord | undefined {
  return writes.find(
    (write) =>
      write.op === "update" && write.filters.id === MATCHED_TASK_ID &&
      "content" in write.payload,
  );
}

// ---------------------------------------------------------------------------
// 1.2 — LLM project inference error preserves existing project_id
// ---------------------------------------------------------------------------

Deno.test("merge: LLM project inference failure omits project_id (preserve)", async () => {
  await withFetchStub(async () => {
    stubFetchFailure(500); // both project inference and enrichment fail
    const { taskRepository, writes } = makeFakeTaskRepository();
    const context = baseContext(taskRepository, {
      knownProjects: [{ id: "proj-1", name: "Some Project" }],
    });

    await new TaskExtractor().extract(
      note([checkbox("Fix the login page")]),
      context,
    );

    const update = matchedUpdate(writes);
    assertEquals(update !== undefined, true);
    assertEquals(
      "project_id" in update!.payload,
      false,
      "project_id must be omitted when LLM inference failed (preserve stored value)",
    );
  });
});

// ---------------------------------------------------------------------------
// 1.3 — No known projects preserves existing project_id
// ---------------------------------------------------------------------------

Deno.test("merge: no known projects omits project_id (preserve)", async () => {
  await withFetchStub(async () => {
    stubFetchFailure(500);
    const { taskRepository, writes } = makeFakeTaskRepository();
    const context = baseContext(taskRepository, { knownProjects: [] });

    await new TaskExtractor().extract(
      note([checkbox("Fix the login page")]),
      context,
    );

    const update = matchedUpdate(writes);
    assertEquals(update !== undefined, true);
    assertEquals(
      "project_id" in update!.payload,
      false,
      "project_id must be omitted when no projects exist to resolve against",
    );
  });
});

// ---------------------------------------------------------------------------
// Positive resolution: heading match SETS project_id to the resolved value
// ---------------------------------------------------------------------------

Deno.test("merge: heading-resolved project sets project_id to the value", async () => {
  await withFetchStub(async () => {
    stubFetchOk({ enrichments: [] });
    const { taskRepository, writes } = makeFakeTaskRepository();
    const context = baseContext(taskRepository, {
      knownProjects: [{ id: "proj-heading", name: "Login Work" }],
    });

    // Section heading equals the project name → deterministic heading match.
    await new TaskExtractor().extract(
      note([checkbox("Fix the login page", { sectionHeading: "Login Work" })]),
      context,
    );

    const update = matchedUpdate(writes);
    assertEquals(update !== undefined, true);
    assertEquals(update!.payload.project_id, "proj-heading");
  });
});

// ---------------------------------------------------------------------------
// Available-empty project inference CLEARS a removed project cue
// ---------------------------------------------------------------------------

Deno.test("merge: available project inference with no assignment clears project_id", async () => {
  await withFetchStub(async () => {
    // Project inference succeeds but assigns nothing; enrichment likewise empty.
    stubFetchOk({ assignments: [], enrichments: [] });
    const { taskRepository, writes } = makeFakeTaskRepository();
    const context = baseContext(taskRepository, {
      knownProjects: [{ id: "proj-1", name: "Some Project" }],
    });

    await new TaskExtractor().extract(
      note([checkbox("Fix the login page")]),
      context,
    );

    const update = matchedUpdate(writes);
    assertEquals(update !== undefined, true);
    assertEquals(
      update!.payload.project_id,
      null,
      "project_id must be cleared when inference ran and assigned no project",
    );
  });
});

// ---------------------------------------------------------------------------
// 1.4 — Available-empty enrichment CLEARS removed due_by / assigned_to
// ---------------------------------------------------------------------------

Deno.test("merge: available enrichment with no result clears due_by and assigned_to", async () => {
  await withFetchStub(async () => {
    // Enrichment succeeds but resolves neither a date nor an assignee.
    stubFetchOk({
      enrichments: [
        {
          task_index: 0,
          assigned_to_id: null,
          due_date: null,
          cleaned_text: "Fix the login page",
        },
      ],
    });
    const { taskRepository, writes } = makeFakeTaskRepository();
    const context = baseContext(taskRepository, {
      knownProjects: [],
      knownPeople: [{ id: "person-1", name: "Alice" }],
    });

    await new TaskExtractor().extract(
      note([checkbox("Fix the login page")]),
      context,
    );

    const update = matchedUpdate(writes);
    assertEquals(update !== undefined, true);
    assertEquals(
      update!.payload.due_by,
      null,
      "due_by must be cleared to null when resolution ran and found no date",
    );
    assertEquals(
      update!.payload.assigned_to,
      null,
      "assigned_to must be cleared to null when resolution ran and found no assignee",
    );
  });
});

// ---------------------------------------------------------------------------
// 1.5 — Unavailable enrichment PRESERVES due_by / assigned_to
// ---------------------------------------------------------------------------

Deno.test("merge: enrichment failure omits due_by and assigned_to (preserve)", async () => {
  await withFetchStub(async () => {
    stubFetchFailure(500);
    const { taskRepository, writes } = makeFakeTaskRepository();
    const context = baseContext(taskRepository, {
      knownProjects: [],
      knownPeople: [{ id: "person-1", name: "Alice" }],
    });

    await new TaskExtractor().extract(
      note([checkbox("Fix the login page")]),
      context,
    );

    const update = matchedUpdate(writes);
    assertEquals(update !== undefined, true);
    assertEquals(
      "due_by" in update!.payload,
      false,
      "due_by must be omitted when enrichment could not run (preserve)",
    );
    assertEquals(
      "assigned_to" in update!.payload,
      false,
      "assigned_to must be omitted when enrichment could not run (preserve)",
    );
  });
});

// ---------------------------------------------------------------------------
// 1.6 — Failed Supabase update surfaces in result.errors
// ---------------------------------------------------------------------------

Deno.test("merge: failed matched-task update is surfaced in result.errors", async () => {
  await withFetchStub(async () => {
    stubFetchFailure(500);
    const { taskRepository } = makeFakeTaskRepository({
      updateError: (record) =>
        record.filters.id === MATCHED_TASK_ID && "content" in record.payload
          ? "simulated write failure"
          : null,
    });
    const context = baseContext(taskRepository, { knownProjects: [] });

    const result = await new TaskExtractor().extract(
      note([checkbox("Fix the login page")]),
      context,
    );

    assertEquals(
      (result.errors ?? []).some((message) =>
        message.includes(MATCHED_TASK_ID)
      ),
      true,
      "a failed matched-task update must appear in result.errors",
    );
  });
});

// ---------------------------------------------------------------------------
// Success path: no errors reported
// ---------------------------------------------------------------------------

Deno.test("merge: successful extraction reports no errors", async () => {
  await withFetchStub(async () => {
    stubFetchOk({ enrichments: [] });
    const { taskRepository } = makeFakeTaskRepository();
    const context = baseContext(taskRepository, { knownProjects: [] });

    const result = await new TaskExtractor().extract(
      note([checkbox("Fix the login page")]),
      context,
    );

    assertEquals(
      result.errors === undefined || result.errors.length === 0,
      true,
    );
  });
});
