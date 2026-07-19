import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  createDefaultExtractors,
  type ExtractionContext,
  type ExtractionResult,
  type Extractor,
  REFERENCE_KEYS,
  runExtractionPipeline,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import { parseNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import {
  FakeAiProvider,
  FakePersonRepository,
  FakeProjectRepository,
  FakeTaskRepository,
} from "./fakes/extraction-fakes.ts";

// Pure, deterministic pipeline-runner unit tests (Step 20). Fake extractors and
// fake repositories — NO DB, NO network, NO LLM. Exercises the runner's ordering
// guarantee, cross-extractor context enrichment, and error surfacing.

// The runner only touches `supabase` if an extractor does; our fake extractors
// never do, so a trivial placeholder is safe here.
const fakeAiProvider = new FakeAiProvider(() => ({}));

/**
 * A fake extractor that records the order in which it ran (into a shared log)
 * and the references it observed from earlier extractors, then contributes its
 * own ids. Optionally reports write errors.
 */
class RecordingExtractor implements Extractor {
  constructor(
    readonly referenceKey: string,
    private readonly ids: string[],
    private readonly runLog: string[],
    private readonly observed: Record<string, string[]>,
    private readonly errors?: string[],
  ) {}

  extract(
    _note: unknown,
    context: ExtractionContext,
  ): Promise<ExtractionResult> {
    this.runLog.push(this.referenceKey);
    // Snapshot what earlier extractors accumulated by the time we run.
    this.observed[this.referenceKey] = Object.keys(
      context.accumulatedReferences,
    );
    return Promise.resolve({
      referenceKey: this.referenceKey,
      ids: this.ids,
      errors: this.errors,
    });
  }
}

function runWith(
  extractors: Extractor[],
  repos?: {
    task?: FakeTaskRepository;
    project?: FakeProjectRepository;
    person?: FakePersonRepository;
  },
) {
  const note = parseNote("- [ ] a task", "Note", null, "obsidian");
  return runExtractionPipeline(note, extractors, {
    aiProvider: fakeAiProvider,
    taskRepository: repos?.task ?? new FakeTaskRepository(),
    projectRepository: repos?.project ?? new FakeProjectRepository(),
    personRepository: repos?.person ?? new FakePersonRepository(),
    timeZone: "UTC",
  });
}

/** Narrow a PipelineOutcome to its success branch or throw with a clear message. */
function expectOk(outcome: Awaited<ReturnType<typeof runWith>>) {
  if (!outcome.ok) {
    throw new Error(`expected ok outcome, got failure: ${outcome.error}`);
  }
  return outcome;
}

Deno.test("pipeline: runs extractors in list order", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const extractors = [
    new RecordingExtractor("projects", ["p1"], runLog, observed),
    new RecordingExtractor("people", ["u1"], runLog, observed),
    new RecordingExtractor("tasks", ["t1"], runLog, observed),
  ];

  await runWith(extractors);

  assertEquals(runLog, ["projects", "people", "tasks"]);
});

Deno.test("pipeline: collects each extractor's ids under its reference key", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const outcome = expectOk(
    await runWith([
      new RecordingExtractor("projects", ["p1", "p2"], runLog, observed),
      new RecordingExtractor("people", ["u1"], runLog, observed),
      new RecordingExtractor("tasks", ["t1"], runLog, observed),
    ]),
  );

  assertEquals(outcome.references, {
    projects: ["p1", "p2"],
    people: ["u1"],
    tasks: ["t1"],
  });
});

Deno.test("pipeline: enriches context so later extractors observe earlier references", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  await runWith([
    new RecordingExtractor("projects", ["p1"], runLog, observed),
    new RecordingExtractor("people", ["u1"], runLog, observed),
    new RecordingExtractor("tasks", ["t1"], runLog, observed),
  ]);

  // The first extractor sees nothing accumulated yet.
  assertEquals(observed["projects"], []);
  // The second sees the first's key; the third sees both prior keys.
  assertEquals(observed["people"], ["projects"]);
  assertEquals(observed["tasks"].sort(), ["people", "projects"]);
});

Deno.test("pipeline: surfaces (logs) extractor write errors, does not swallow", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  try {
    await runWith([
      new RecordingExtractor("projects", ["p1"], runLog, observed, [
        "insert failed: boom",
      ]),
    ]);
  } finally {
    console.error = originalError;
  }

  assertEquals(logged.length, 1);
  assertStringIncludes(logged[0], "insert failed: boom");
  assertStringIncludes(logged[0], "projects");
});

// ---------------------------------------------------------------------------
// EXTR-6 — extractor write errors are RETURNED (not just logged) so callers
// can report partial failure (failing-first).
// ---------------------------------------------------------------------------

Deno.test("pipeline: returns collected extractor write errors on the outcome", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const originalError = console.error;
  console.error = () => {};
  let outcome;
  try {
    outcome = expectOk(
      await runWith([
        new RecordingExtractor("projects", ["p1"], runLog, observed, [
          "project insert failed: boom",
        ]),
        new RecordingExtractor("people", ["u1"], runLog, observed, [
          "person insert failed: bang",
        ]),
      ]),
    );
  } finally {
    console.error = originalError;
  }

  assertEquals(outcome.errors.sort(), [
    "person insert failed: bang",
    "project insert failed: boom",
  ]);
});

Deno.test("pipeline: success outcome has an empty errors array when all writes succeed", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const outcome = expectOk(
    await runWith([
      new RecordingExtractor("projects", ["p1"], runLog, observed),
    ]),
  );
  assertEquals(outcome.errors, []);
});

// ---------------------------------------------------------------------------
// EXTR-2 — a failed SEED read aborts extraction (no extractor runs, no writes),
// instead of coalescing to an empty context and duplicating tasks (failing-first).
// ---------------------------------------------------------------------------

Deno.test("pipeline: aborts (no writes) when the known-tasks seed read fails", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  // findByReference errors → knownTasks would silently be [] and every checkbox
  // would be re-created. The pipeline must abort instead.
  const failingTasks = new FakeTaskRepository();
  failingTasks.findByReference = () =>
    Promise.resolve({ data: null, error: { message: "tasks read failed" } });

  const note = parseNote(
    "- [ ] a task",
    "Note",
    "notes/re-ingest.md",
    "obsidian",
  );
  const outcome = await runExtractionPipeline(
    note,
    [new RecordingExtractor("tasks", ["t1"], runLog, observed)],
    {
      aiProvider: fakeAiProvider,
      taskRepository: failingTasks,
      projectRepository: new FakeProjectRepository(),
      personRepository: new FakePersonRepository(),
      timeZone: "UTC",
    },
  );

  assertEquals(outcome.ok, false);
  assertEquals(runLog, []); // no extractor ran
  assertEquals(failingTasks.inserted.length, 0); // no task inserted
});

Deno.test("pipeline: aborts when the active-projects seed read fails", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const failingProjects = new FakeProjectRepository();
  failingProjects.listActive = () =>
    Promise.resolve({ data: null, error: { message: "projects read failed" } });

  const outcome = await runWith(
    [new RecordingExtractor("projects", ["p1"], runLog, observed)],
    { project: failingProjects },
  );

  assertEquals(outcome.ok, false);
  assertEquals(runLog, []);
  assertEquals(failingProjects.inserted.length, 0);
});

Deno.test("pipeline: aborts when the active-people seed read fails", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const failingPeople = new FakePersonRepository();
  failingPeople.listActive = () =>
    Promise.resolve({ data: null, error: { message: "people read failed" } });

  const outcome = await runWith(
    [new RecordingExtractor("people", ["u1"], runLog, observed)],
    { person: failingPeople },
  );

  assertEquals(outcome.ok, false);
  assertEquals(runLog, []);
  assertEquals(failingPeople.inserted.length, 0);
});

// ---------------------------------------------------------------------------
// Moved from tests/integration/extractors.test.ts (TEST-14): these fake the
// extractors on the pipeline↔extractor path, so they are unit tests. The
// order/composition variants that duplicated "runs extractors in list order"
// and "collects each extractor's ids under its reference key" were merged into
// those existing tests; the scenarios below are the distinct remainders.
// ---------------------------------------------------------------------------

Deno.test("pipeline: single extractor returns correct references", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const outcome = expectOk(
    await runWith([
      new RecordingExtractor(
        "projects",
        ["uuid-1", "uuid-2"],
        runLog,
        observed,
      ),
    ]),
  );

  assertEquals(outcome.references, { projects: ["uuid-1", "uuid-2"] });
});

Deno.test("pipeline: context enrichment visible to downstream extractors", async () => {
  let downstreamSawProject = false;

  const enrichingExtractor: Extractor = {
    referenceKey: "projects",
    extract: (_note, context) => {
      context.newlyCreatedProjects.push({ id: "new-proj-id", name: "NewProj" });
      return Promise.resolve({
        referenceKey: "projects",
        ids: ["new-proj-id"],
      });
    },
  };

  const observingExtractor: Extractor = {
    referenceKey: "tasks",
    extract: (_note, context) => {
      downstreamSawProject = context.newlyCreatedProjects.some(
        (project) => project.id === "new-proj-id",
      );
      return Promise.resolve({ referenceKey: "tasks", ids: [] });
    },
  };

  await runWith([enrichingExtractor, observingExtractor]);

  assertEquals(downstreamSawProject, true);
});

Deno.test("pipeline: extractor returning empty ids includes key in result", async () => {
  const runLog: string[] = [];
  const observed: Record<string, string[]> = {};
  const outcome = expectOk(
    await runWith([
      new RecordingExtractor("projects", [], runLog, observed),
    ]),
  );

  assertEquals("projects" in outcome.references, true);
  assertEquals(outcome.references.projects, []);
});

Deno.test("createDefaultExtractors: returns the three concrete extractors in order", () => {
  const extractors = createDefaultExtractors();
  assertEquals(extractors.map((extractor) => extractor.referenceKey), [
    REFERENCE_KEYS.projects,
    REFERENCE_KEYS.people,
    REFERENCE_KEYS.tasks,
  ]);
});

Deno.test("createDefaultExtractors: returns a fresh array each call", () => {
  const first = createDefaultExtractors();
  const second = createDefaultExtractors();
  assertEquals(first === second, false);
  first.length = 0;
  assertEquals(second.length, 3);
});
