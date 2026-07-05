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

// Unit tests for TaskExtractor re-ingest MERGE SEMANTICS (finding C6, Step 8).
// Drives the REAL TaskExtractor.extract against a fake Supabase context and a
// stubbed global fetch — no DB, no network, no real OpenRouter key. A throwaway
// key must be present so the fail-fast `requireEnv` guard (Step 10) passes
// before the stubbed fetch is reached.

Deno.env.set("OPENROUTER_API_KEY", "test-openrouter-key");

const NOTE_REF = "notes/re-ingest.md";

// ---------------------------------------------------------------------------
// Fake Supabase: records write payloads; can be told to fail updates.
// Implements only the chains TaskExtractor actually calls:
//   .from(t).update(payload).eq(...)            (awaited → { error })
//   .from(t).update(payload).eq(...).is(...)    (awaited → { error })
//   .from(t).insert(payload).select(...).single()  (→ { data, error })
// ---------------------------------------------------------------------------

interface WriteRecord {
  table: string;
  op: "update" | "insert";
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
}

interface FakeSupabaseOptions {
  /** Return an error message for a given update write, or null to succeed. */
  updateError?: (record: WriteRecord) => string | null;
  /** Error message for insert writes, or null (default) to succeed. */
  insertError?: string | null;
}

function makeFakeSupabase(
  options: FakeSupabaseOptions = {},
): { supabase: SupabaseClient; writes: WriteRecord[] } {
  const writes: WriteRecord[] = [];
  let insertCounter = 0;

  const from = (table: string) => {
    const record: WriteRecord = {
      table,
      op: "update",
      payload: {},
      filters: {},
    };
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      update(payload: Record<string, unknown>) {
        record.op = "update";
        record.payload = payload;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        record.op = "insert";
        record.payload = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        record.filters[column] = value;
        return builder;
      },
      is(column: string, value: unknown) {
        record.filters[column] = value;
        return builder;
      },
      select(_columns: string) {
        return builder;
      },
      single() {
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
            content: String(record.payload.content ?? ""),
          },
          error: null,
        });
      },
      then(resolve: (value: { error: { message: string } | null }) => void) {
        writes.push(record);
        const errorMessage = options.updateError?.(record) ?? null;
        resolve({ error: errorMessage ? { message: errorMessage } : null });
      },
    };
    return builder;
  };

  return { supabase: { from } as unknown as SupabaseClient, writes };
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
  supabase: SupabaseClient,
  overrides: Partial<ExtractionContext> = {},
): ExtractionContext {
  return {
    supabase,
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
    const { supabase, writes } = makeFakeSupabase();
    const context = baseContext(supabase, {
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
    const { supabase, writes } = makeFakeSupabase();
    const context = baseContext(supabase, { knownProjects: [] });

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
    const { supabase, writes } = makeFakeSupabase();
    const context = baseContext(supabase, {
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
    const { supabase, writes } = makeFakeSupabase();
    const context = baseContext(supabase, {
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
    const { supabase, writes } = makeFakeSupabase();
    const context = baseContext(supabase, {
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
    const { supabase, writes } = makeFakeSupabase();
    const context = baseContext(supabase, {
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
    const { supabase } = makeFakeSupabase({
      updateError: (record) =>
        record.filters.id === MATCHED_TASK_ID && "content" in record.payload
          ? "simulated write failure"
          : null,
    });
    const context = baseContext(supabase, { knownProjects: [] });

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
    const { supabase } = makeFakeSupabase();
    const context = baseContext(supabase, { knownProjects: [] });

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
