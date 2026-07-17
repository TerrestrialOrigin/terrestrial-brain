import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { PeopleExtractor } from "../../supabase/functions/terrestrial-brain-mcp/extractors/people-extractor.ts";
import type { ExtractionContext } from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import { parseNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KnownPerson } from "../../supabase/functions/terrestrial-brain-mcp/extractors/name-matching.ts";
import {
  FakeAiProvider,
  FakePersonRepository,
  FakeProjectRepository,
  FakeTaskRepository,
} from "./fakes/extraction-fakes.ts";

// Deterministic PeopleExtractor unit tests (Step 20). The LLM is a FakeAiProvider
// feeding canned detections through the extractor's own parse/validation — NO
// network, NO key. Focus: LLM output is validated against the known-people
// allowlist so a hallucinated id can never become a "known" reference.

const ALICE_ID = "00000000-0000-0000-0000-100000000001";
const fakeSupabase = {} as unknown as SupabaseClient;

function makeContext(
  knownPeople: KnownPerson[],
  aiProvider: FakeAiProvider,
  personRepository: FakePersonRepository,
): ExtractionContext {
  return {
    supabase: fakeSupabase,
    aiProvider,
    taskRepository: new FakeTaskRepository(),
    projectRepository: new FakeProjectRepository(),
    personRepository,
    knownProjects: [],
    knownTasks: [],
    knownPeople,
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };
}

Deno.test("PeopleExtractor: keeps an explicit known-id match", async () => {
  const note = parseNote(
    "Ask Alice about the design",
    "Note",
    null,
    "obsidian",
  );
  const provider = new FakeAiProvider(() => ({
    people: [{ name: "Alice", id: ALICE_ID }],
  }));
  const personRepository = new FakePersonRepository();
  const context = makeContext(
    [{ id: ALICE_ID, name: "Alice" }],
    provider,
    personRepository,
  );

  const result = await new PeopleExtractor().extract(note, context);

  assertEquals(result.ids, [ALICE_ID]);
  // No auto-create for an already-known person.
  assertEquals(personRepository.inserted.length, 0);
});

Deno.test("PeopleExtractor: drops a hallucinated (non-allowlisted) person id", async () => {
  const note = parseNote("Talk to Ghost about it", "Note", null, "obsidian");
  // The model returns an id NOT in the known-people allowlist.
  const provider = new FakeAiProvider(() => ({
    people: [{ name: "Ghost", id: "99999999-hallucinated-id" }],
  }));
  const personRepository = new FakePersonRepository();
  const context = makeContext(
    [{ id: ALICE_ID, name: "Alice" }],
    provider,
    personRepository,
  );

  const result = await new PeopleExtractor().extract(note, context);

  // The hallucinated id must never appear as a known reference.
  assertEquals(result.ids.includes("99999999-hallucinated-id"), false);
  // Treated as a new unknown name -> auto-created with a fresh (fake) id.
  assertEquals(personRepository.inserted.length, 1);
  assertEquals(personRepository.inserted[0].name, "Ghost");
  assertEquals(result.ids, [personRepository.inserted[0].id]);
});

Deno.test("PeopleExtractor: empty note content short-circuits with no LLM call", async () => {
  const note = parseNote("", null, null, "obsidian");
  const provider = new FakeAiProvider(() => ({ people: [] }));
  const personRepository = new FakePersonRepository();
  const context = makeContext([], provider, personRepository);

  const result = await new PeopleExtractor().extract(note, context);

  assertEquals(result.ids, []);
  assertEquals(provider.requests.length, 0);
});

// ---------------------------------------------------------------------------
// EXTR-6 — auto-create failures are RETURNED in result.errors, not just logged
// (failing-first).
// ---------------------------------------------------------------------------

Deno.test("PeopleExtractor: auto-create failure is reported in result.errors", async () => {
  const note = parseNote("Talk to Ghost about it", "Note", null, "obsidian");
  const provider = new FakeAiProvider(() => ({
    people: [{ name: "Ghost", id: null }],
  }));
  const personRepository = new FakePersonRepository();
  personRepository.insert = () =>
    Promise.resolve({ data: null, error: { message: "insert denied" } });
  const context = makeContext([], provider, personRepository);

  const originalError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await new PeopleExtractor().extract(note, context);
  } finally {
    console.error = originalError;
  }

  assertEquals(result.ids, []);
  assertExists(result.errors);
  assertEquals(result.errors.length, 1);
  assertStringIncludes(result.errors[0], "Ghost");
  assertStringIncludes(result.errors[0], "insert denied");
});
