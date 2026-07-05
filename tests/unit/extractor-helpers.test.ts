import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractProjectFromConventionalPath } from "../../supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts";
import {
  buildTaskMetadata,
  computeSimilarity,
  extractAssignment,
  matchPersonInText,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts";
import {
  containsDateLikeWords,
  extractDueDate,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/date-parser.ts";

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
  assertEquals(extractProjectFromConventionalPath("projects//somefile.md"), null);
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
  const score = computeSimilarity("Fix the navbar styling", "Fix the navbar styles");
  assertEquals(score > 0.8, true);
});

Deno.test("computeSimilarity: empty string returns 0.0", () => {
  assertEquals(computeSimilarity("", "something"), 0.0);
  assertEquals(computeSimilarity("something", ""), 0.0);
});

// ---------------------------------------------------------------------------
// 9.0 — date-parser unit tests
// ---------------------------------------------------------------------------

const REFERENCE_DATE = new Date("2026-03-24T12:00:00Z");

Deno.test("extractDueDate: ISO date with marker", () => {
  const result = extractDueDate("Fix deployment by 2026-04-01", REFERENCE_DATE);
  assertEquals(result.dueDate, "2026-04-01T00:00:00.000Z");
  assertEquals(result.cleanedText, "Fix deployment");
});

Deno.test("extractDueDate: bare ISO date", () => {
  const result = extractDueDate("2026-04-01 Fix deployment", REFERENCE_DATE);
  assertEquals(result.dueDate, "2026-04-01T00:00:00.000Z");
  assertEquals(result.cleanedText, "Fix deployment");
});

Deno.test("extractDueDate: ISO date with slashes", () => {
  const result = extractDueDate("Fix bug by 2026/04/01", REFERENCE_DATE);
  assertEquals(result.dueDate, "2026-04-01T00:00:00.000Z");
  assertEquals(result.cleanedText, "Fix bug");
});

Deno.test("extractDueDate: natural date with marker (Month Day)", () => {
  const result = extractDueDate("Review PR due March 30", REFERENCE_DATE);
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2026-03-30T00:00:00.000Z");
  assertEquals(result.cleanedText, "Review PR");
});

Deno.test("extractDueDate: natural date with marker (Day Month)", () => {
  const result = extractDueDate("Review PR due 30 March", REFERENCE_DATE);
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2026-03-30T00:00:00.000Z");
  assertEquals(result.cleanedText, "Review PR");
});

Deno.test("extractDueDate: natural date with year", () => {
  const result = extractDueDate("Ship feature by March 30, 2027", REFERENCE_DATE);
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2027-03-30T00:00:00.000Z");
  assertEquals(result.cleanedText, "Ship feature");
});

Deno.test("extractDueDate: abbreviated month", () => {
  const result = extractDueDate("Fix bug due Apr 15", REFERENCE_DATE);
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2026-04-15T00:00:00.000Z");
  assertEquals(result.cleanedText, "Fix bug");
});

Deno.test("extractDueDate: relative day (by Friday)", () => {
  const result = extractDueDate("Deploy by Friday", REFERENCE_DATE);
  assertExists(result.dueDate);
  // 2026-03-24 is Tuesday, so Friday is 2026-03-27
  assertEquals(result.dueDate, "2026-03-27T00:00:00.000Z");
  assertEquals(result.cleanedText, "Deploy");
});

Deno.test("extractDueDate: relative day (due next Monday)", () => {
  const result = extractDueDate("Write report due next Monday", REFERENCE_DATE);
  assertExists(result.dueDate);
  // 2026-03-24 is Tuesday, so next Monday is 2026-03-30
  assertEquals(result.dueDate, "2026-03-30T00:00:00.000Z");
  assertEquals(result.cleanedText, "Write report");
});

Deno.test("extractDueDate: tomorrow", () => {
  const result = extractDueDate("Fix critical bug by tomorrow", REFERENCE_DATE);
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2026-03-25T00:00:00.000Z");
  assertEquals(result.cleanedText, "Fix critical bug");
});

Deno.test("extractDueDate: deadline marker", () => {
  const result = extractDueDate("Submit report deadline: April 1", REFERENCE_DATE);
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2026-04-01T00:00:00.000Z");
  assertEquals(result.cleanedText, "Submit report");
});

Deno.test("extractDueDate: no date returns null and original text", () => {
  const result = extractDueDate("Just a regular task", REFERENCE_DATE);
  assertEquals(result.dueDate, null);
  assertEquals(result.cleanedText, "Just a regular task");
});

Deno.test("extractDueDate: past month infers next year", () => {
  // Reference date is March 2026, January is past
  const result = extractDueDate("Finish audit by January 15", REFERENCE_DATE);
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2027-01-15T00:00:00.000Z");
});

Deno.test("containsDateLikeWords: detects month names", () => {
  assertEquals(containsDateLikeWords("Ship by March"), true);
});

Deno.test("containsDateLikeWords: detects day names", () => {
  assertEquals(containsDateLikeWords("Deploy on Friday"), true);
});

Deno.test("containsDateLikeWords: detects tomorrow", () => {
  assertEquals(containsDateLikeWords("Fix by tomorrow"), true);
});

Deno.test("containsDateLikeWords: returns false for plain text", () => {
  assertEquals(containsDateLikeWords("Just a regular task"), false);
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
  const result = matchPersonInText("Ask Alice about the design", TEST_PEOPLE);
  assertEquals(result, ALICE_ID);
});

Deno.test("matchPersonInText: case-insensitive match", () => {
  const result = matchPersonInText("ask ALICE about the design", TEST_PEOPLE);
  assertEquals(result, ALICE_ID);
});

Deno.test("matchPersonInText: no match returns null", () => {
  const result = matchPersonInText("Fix the login page", TEST_PEOPLE);
  assertEquals(result, null);
});

Deno.test("matchPersonInText: multiple people returns first by position", () => {
  const result = matchPersonInText("Claude and Alice reviewed this", TEST_PEOPLE);
  assertEquals(result, CLAUDE_ID);
});

Deno.test("matchPersonInText: empty text returns null", () => {
  const result = matchPersonInText("", TEST_PEOPLE);
  assertEquals(result, null);
});

Deno.test("matchPersonInText: empty people list returns null", () => {
  const result = matchPersonInText("Ask Alice", []);
  assertEquals(result, null);
});

Deno.test("matchPersonInText: skips very short names", () => {
  const shortNamePeople = [{ id: "short-id", name: "X" }];
  const result = matchPersonInText("Fix X component", shortNamePeople);
  assertEquals(result, null);
});

// --- partial name matching ---

const PARTIAL_PEOPLE = [
  { id: "id-bub", name: "Bub Goodwin" },
  { id: ALICE_ID, name: "Alice Cooper" },
];

Deno.test("matchPersonInText: first name matches when unambiguous", () => {
  const result = matchPersonInText("Ask Bub about the deploy", PARTIAL_PEOPLE);
  assertEquals(result, "id-bub");
});

Deno.test("matchPersonInText: last name matches when unambiguous", () => {
  const result = matchPersonInText("Goodwin will handle this", PARTIAL_PEOPLE);
  assertEquals(result, "id-bub");
});

Deno.test("matchPersonInText: ambiguous partial name returns null", () => {
  const ambiguousPeople = [
    { id: "id-john-s", name: "John Smith" },
    { id: "id-john-d", name: "John Doe" },
  ];
  const result = matchPersonInText("John will review", ambiguousPeople);
  assertEquals(result, null);
});

Deno.test("matchPersonInText: full name match takes priority over partial", () => {
  const result = matchPersonInText("Bub Goodwin mentioned it", PARTIAL_PEOPLE);
  assertEquals(result, "id-bub");
});

Deno.test("matchPersonInText: partial match is case-insensitive", () => {
  const result = matchPersonInText("talk to goodwin", PARTIAL_PEOPLE);
  assertEquals(result, "id-bub");
});

Deno.test("matchPersonInText: partial name not matched inside other words", () => {
  const alPeople = [{ id: "id-al", name: "Al Green" }];
  const result = matchPersonInText("Also check the logs", alPeople);
  assertEquals(result, null);
});

// ---------------------------------------------------------------------------
// 9.13 — extractAssignment unit tests
// ---------------------------------------------------------------------------

Deno.test("extractAssignment: explicit pattern strips and returns personId", () => {
  const result = extractAssignment("Review the PR (assigned: Alice)", TEST_PEOPLE);
  assertEquals(result.personId, ALICE_ID);
  assertEquals(result.cleanedText, "Review the PR");
});

Deno.test("extractAssignment: owner pattern works", () => {
  const result = extractAssignment("Deploy service (owner: Claude)", TEST_PEOPLE);
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
