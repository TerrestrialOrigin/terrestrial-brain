import { assertEquals } from "@std/assert";
import { extractProjectFromConventionalPath } from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";
import {
  buildTaskMetadata,
  computeSimilarity,
  extractAssignment,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts";
import { findPersonInText } from "../../supabase/functions/terrestrial-brain-mcp/extractors/name-matching.ts";
// Pure, deterministic extractor-helper unit tests. No DB, no network, no LLM.
// Moved here from tests/integration/extractors.test.ts (Step 5 test-suite split).

// Seed people IDs (from seed.sql) — used by the person-matching fixtures below.
const ALICE_ID = "00000000-0000-0000-0000-100000000001";
const CLAUDE_ID = "00000000-0000-0000-0000-100000000002";

// ---------------------------------------------------------------------------
// 3.1b — extractProjectFromConventionalPath unit tests
// ---------------------------------------------------------------------------

Deno.test("extractProjectFromConventionalPath: extracts name from projects path", () => {
  assertEquals(
    extractProjectFromConventionalPath("projects/Test Proj/sprint-notes.md"),
    "Test Proj",
  );
});

Deno.test("extractProjectFromConventionalPath: extracts from nested path", () => {
  assertEquals(
    extractProjectFromConventionalPath("projects/Test Proj/sprints/week1.md"),
    "Test Proj",
  );
});

Deno.test("extractProjectFromConventionalPath: returns null for non-projects path", () => {
  assertEquals(extractProjectFromConventionalPath("daily/2026-03-22.md"), null);
});

Deno.test("extractProjectFromConventionalPath: returns null for empty folder name", () => {
  assertEquals(
    extractProjectFromConventionalPath("projects//somefile.md"),
    null,
  );
});

Deno.test("extractProjectFromConventionalPath: returns null for null referenceId", () => {
  assertEquals(extractProjectFromConventionalPath(null), null);
});

Deno.test("extractProjectFromConventionalPath: returns null for projects without trailing slash", () => {
  assertEquals(extractProjectFromConventionalPath("projects"), null);
});

// ---------------------------------------------------------------------------
// 7.0 — computeSimilarity unit tests
// ---------------------------------------------------------------------------

Deno.test("computeSimilarity: identical strings return 1.0", () => {
  assertEquals(computeSimilarity("Buy groceries", "Buy groceries"), 1.0);
});

Deno.test("computeSimilarity: case-insensitive identical strings return 1.0", () => {
  assertEquals(computeSimilarity("Buy Groceries", "buy groceries"), 1.0);
});

Deno.test("computeSimilarity: completely different strings return low score", () => {
  const score = computeSimilarity("Buy groceries", "Fix the login page");
  assertEquals(score < 0.5, true);
});

Deno.test("computeSimilarity: slightly edited string returns high score", () => {
  const score = computeSimilarity(
    "Fix the navbar styling",
    "Fix the navbar styles",
  );
  assertEquals(score > 0.8, true);
});

Deno.test("computeSimilarity: empty string returns 0.0", () => {
  assertEquals(computeSimilarity("", "something"), 0.0);
  assertEquals(computeSimilarity("something", ""), 0.0);
});

// ---------------------------------------------------------------------------
// 9.1 — buildTaskMetadata unit tests
// ---------------------------------------------------------------------------

Deno.test("buildTaskMetadata: returns correct shape", () => {
  const metadata = buildTaskMetadata("obsidian", "Sprint 12");
  assertEquals(metadata.source, "obsidian");
  assertEquals(metadata.section_heading, "Sprint 12");
  assertEquals(Object.keys(metadata).length, 2);
});

Deno.test("buildTaskMetadata: null section heading", () => {
  const metadata = buildTaskMetadata("obsidian", null);
  assertEquals(metadata.source, "obsidian");
  assertEquals(metadata.section_heading, undefined);
  assertEquals(Object.keys(metadata).length, 1);
});

Deno.test("buildTaskMetadata: only source when no heading", () => {
  const metadata = buildTaskMetadata("obsidian", null);
  assertEquals(metadata.source, "obsidian");
  assertEquals("section_heading" in metadata, false);
});

// ---------------------------------------------------------------------------
// 9.2 — matchPersonInText unit tests
// ---------------------------------------------------------------------------

const TEST_PEOPLE = [
  { id: ALICE_ID, name: "Alice" },
  { id: CLAUDE_ID, name: "Claude" },
];

Deno.test("matchPersonInText: exact match returns person UUID", () => {
  const result = findPersonInText("Ask Alice about the design", TEST_PEOPLE);
  assertEquals(result, ALICE_ID);
});

Deno.test("matchPersonInText: case-insensitive match", () => {
  const result = findPersonInText("ask ALICE about the design", TEST_PEOPLE);
  assertEquals(result, ALICE_ID);
});

Deno.test("matchPersonInText: no match returns null", () => {
  const result = findPersonInText("Fix the login page", TEST_PEOPLE);
  assertEquals(result, null);
});

Deno.test("matchPersonInText: multiple people returns first by position", () => {
  const result = findPersonInText(
    "Claude and Alice reviewed this",
    TEST_PEOPLE,
  );
  assertEquals(result, CLAUDE_ID);
});

Deno.test("matchPersonInText: empty text returns null", () => {
  const result = findPersonInText("", TEST_PEOPLE);
  assertEquals(result, null);
});

Deno.test("matchPersonInText: empty people list returns null", () => {
  const result = findPersonInText("Ask Alice", []);
  assertEquals(result, null);
});

Deno.test("matchPersonInText: skips very short names", () => {
  const shortNamePeople = [{ id: "short-id", name: "X" }];
  const result = findPersonInText("Fix X component", shortNamePeople);
  assertEquals(result, null);
});

// --- partial name matching ---

const PARTIAL_PEOPLE = [
  { id: "id-bub", name: "Bub Goodwin" },
  { id: ALICE_ID, name: "Alice Cooper" },
];

Deno.test("matchPersonInText: first name matches when unambiguous", () => {
  const result = findPersonInText("Ask Bub about the deploy", PARTIAL_PEOPLE);
  assertEquals(result, "id-bub");
});

Deno.test("matchPersonInText: last name matches when unambiguous", () => {
  const result = findPersonInText("Goodwin will handle this", PARTIAL_PEOPLE);
  assertEquals(result, "id-bub");
});

Deno.test("matchPersonInText: ambiguous partial name returns null", () => {
  const ambiguousPeople = [
    { id: "id-john-s", name: "John Smith" },
    { id: "id-john-d", name: "John Doe" },
  ];
  const result = findPersonInText("John will review", ambiguousPeople);
  assertEquals(result, null);
});

Deno.test("matchPersonInText: full name match takes priority over partial", () => {
  const result = findPersonInText("Bub Goodwin mentioned it", PARTIAL_PEOPLE);
  assertEquals(result, "id-bub");
});

Deno.test("matchPersonInText: partial match is case-insensitive", () => {
  const result = findPersonInText("talk to goodwin", PARTIAL_PEOPLE);
  assertEquals(result, "id-bub");
});

Deno.test("matchPersonInText: partial name not matched inside other words", () => {
  const alPeople = [{ id: "id-al", name: "Al Green" }];
  const result = findPersonInText("Also check the logs", alPeople);
  assertEquals(result, null);
});

// ---------------------------------------------------------------------------
// 9.13 — extractAssignment unit tests
// ---------------------------------------------------------------------------

Deno.test("extractAssignment: explicit pattern strips and returns personId", () => {
  const result = extractAssignment(
    "Review the PR (assigned: Alice)",
    TEST_PEOPLE,
  );
  assertEquals(result.personId, ALICE_ID);
  assertEquals(result.cleanedText, "Review the PR");
});

Deno.test("extractAssignment: owner pattern works", () => {
  const result = extractAssignment(
    "Deploy service (owner: Claude)",
    TEST_PEOPLE,
  );
  assertEquals(result.personId, CLAUDE_ID);
  assertEquals(result.cleanedText, "Deploy service");
});

Deno.test("extractAssignment: unknown person leaves text unchanged", () => {
  const result = extractAssignment("Review PR (assigned: Bob)", TEST_PEOPLE);
  assertEquals(result.personId, null);
  assertEquals(result.cleanedText, "Review PR (assigned: Bob)");
});

Deno.test("extractAssignment: no pattern returns null personId", () => {
  const result = extractAssignment("Just a regular task", TEST_PEOPLE);
  assertEquals(result.personId, null);
  assertEquals(result.cleanedText, "Just a regular task");
});

// ─── Step 20 (EXTR-3): assignment uses tiered name matching ─────────────────

Deno.test("extractAssignment: exact-part match beats accidental containment regardless of list order", () => {
  const people = [
    { id: "bob-1", name: "Bob Smith" },
    { id: "bo-1", name: "Bo Diddley" },
  ];
  const result = extractAssignment("Fix bug (assigned: Bo)", people);
  assertEquals(
    result.personId,
    "bo-1",
    "'Bo' must match Bo Diddley, not the earlier-listed Bob Smith by containment",
  );
});

Deno.test("extractAssignment: ambiguous short candidate assigns nobody", () => {
  const people = [
    { id: "ann-s", name: "Ann Smith" },
    { id: "ann-j", name: "Ann Jones" },
  ];
  const result = extractAssignment("Plan sprint (assigned: Ann)", people);
  assertEquals(
    result.personId,
    null,
    "an ambiguous candidate must fall through to the AI path, not pick by list order",
  );
  assertEquals(result.cleanedText, "Plan sprint (assigned: Ann)");
});
