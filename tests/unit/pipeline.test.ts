import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createDefaultExtractors,
  type ExtractionContext,
  type ExtractionResult,
  type Extractor,
  REFERENCE_KEYS,
  runExtractionPipeline,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import { parseNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
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
const fakeSupabase = {} as unknown as SupabaseClient;
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

function runWith(extractors: Extractor[]) {
  const note = parseNote("- [ ] a task", "Note", null, "obsidian");
  return runExtractionPipeline(
    note,
    extractors,
    fakeSupabase,
    fakeAiProvider,
    new FakeTaskRepository(),
    new FakeProjectRepository(),
    new FakePersonRepository(),
  );
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
  const references = await runWith([
    new RecordingExtractor("projects", ["p1", "p2"], runLog, observed),
    new RecordingExtractor("people", ["u1"], runLog, observed),
    new RecordingExtractor("tasks", ["t1"], runLog, observed),
  ]);

  assertEquals(references, {
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
