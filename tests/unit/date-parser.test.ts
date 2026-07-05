import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractDueDate } from "../../supabase/functions/terrestrial-brain-mcp/extractors/date-parser.ts";

// Pure, deterministic date-parser unit tests. No DB, no network, no LLM.
// The reference date (and timezone, where relevant) is injected so results are
// stable regardless of when/where the suite runs.
// Relocated from tests/integration -> extractor-helpers (Step 5) -> here (Step 9).

const REFERENCE_DATE = new Date("2026-03-24T12:00:00Z"); // Tuesday, mid-day UTC

// ---------------------------------------------------------------------------
// Regression coverage moved from extractor-helpers.test.ts
// ---------------------------------------------------------------------------

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
  const result = extractDueDate(
    "Ship feature by March 30, 2027",
    REFERENCE_DATE,
  );
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

Deno.test("extractDueDate: tomorrow", () => {
  const result = extractDueDate("Fix critical bug by tomorrow", REFERENCE_DATE);
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2026-03-25T00:00:00.000Z");
  assertEquals(result.cleanedText, "Fix critical bug");
});

Deno.test("extractDueDate: deadline marker", () => {
  const result = extractDueDate(
    "Submit report deadline: April 1",
    REFERENCE_DATE,
  );
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

// ---------------------------------------------------------------------------
// C7 — timezone-aware relative-date resolution (failing-first)
// ---------------------------------------------------------------------------

// 2026-03-25T00:30:00Z is 2026-03-24 20:30 in America/New_York (EDT, UTC-4).
// The user's calendar day is still the 24th; UTC has already rolled to the 25th.
const EVENING_EDT = new Date("2026-03-25T00:30:00Z");

Deno.test("extractDueDate: 'tomorrow' resolves in user timezone, not UTC", () => {
  const result = extractDueDate(
    "Fix bug by tomorrow",
    EVENING_EDT,
    "America/New_York",
  );
  assertExists(result.dueDate);
  // User-zone today is the 24th, so tomorrow is the 25th (NOT the 26th).
  assertEquals(result.dueDate, "2026-03-25T00:00:00.000Z");
  assertEquals(result.cleanedText, "Fix bug");
});

Deno.test("extractDueDate: weekday resolves in user timezone, not UTC", () => {
  // 2026-03-30T03:30:00Z is 2026-03-29 23:30 in America/New_York (Sunday).
  // Zone today = Sunday 03-29 -> nearest upcoming Monday is tomorrow, 03-30.
  // UTC today = Monday 03-30 -> nearest upcoming Monday would be +7, 04-06.
  const sundayNightEdt = new Date("2026-03-30T03:30:00Z");
  const result = extractDueDate(
    "Deploy by Monday",
    sundayNightEdt,
    "America/New_York",
  );
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2026-03-30T00:00:00.000Z");
});

Deno.test("extractDueDate: year inference uses user-timezone calendar date", () => {
  // 2027-01-01T02:00:00Z is 2026-12-31 21:00 in America/New_York.
  // User-zone year is still 2026, so 'by March 30' infers 2027 (upcoming).
  // If computed in UTC, the year base would already be 2027 and March 30 2027
  // would be treated as this-year, still 2027 here — pick a case that differs:
  // 'by December 31' from user-zone 2026-12-31 is TODAY (this year 2026),
  // but from UTC 2027-01-01 it would infer 2027.
  const newYearEve = new Date("2027-01-01T02:00:00Z");
  const result = extractDueDate(
    "Wrap up by December 31",
    newYearEve,
    "America/New_York",
  );
  assertExists(result.dueDate);
  assertEquals(result.dueDate, "2026-12-31T00:00:00.000Z");
});

// ---------------------------------------------------------------------------
// C7 — bare ISO word boundary (failing-first)
// ---------------------------------------------------------------------------

Deno.test("extractDueDate: bare ISO date inside a URL is NOT captured", () => {
  const text = "Review https://example.com/2026-04-01/report";
  const result = extractDueDate(text, REFERENCE_DATE);
  assertEquals(result.dueDate, null);
  assertEquals(result.cleanedText, text);
});

Deno.test("extractDueDate: bare ISO date inside a version string is NOT captured", () => {
  const text = "Bump to v1.2026-04-01";
  const result = extractDueDate(text, REFERENCE_DATE);
  assertEquals(result.dueDate, null);
  assertEquals(result.cleanedText, text);
});

Deno.test("extractDueDate: standalone bare ISO date is still captured", () => {
  const result = extractDueDate("2026-04-01 Fix deployment", REFERENCE_DATE);
  assertEquals(result.dueDate, "2026-04-01T00:00:00.000Z");
  assertEquals(result.cleanedText, "Fix deployment");
});

// ---------------------------------------------------------------------------
// Documented behavior and edge cases
// ---------------------------------------------------------------------------

Deno.test("extractDueDate: 'next Monday' == nearest upcoming Monday", () => {
  const result = extractDueDate("Write report due next Monday", REFERENCE_DATE);
  assertExists(result.dueDate);
  // 2026-03-24 is Tuesday, so the nearest upcoming Monday is 2026-03-30.
  assertEquals(result.dueDate, "2026-03-30T00:00:00.000Z");
  assertEquals(result.cleanedText, "Write report");
});

Deno.test("extractDueDate: invalid timezone falls back to UTC", () => {
  const result = extractDueDate(
    "Fix bug by tomorrow",
    REFERENCE_DATE,
    "Not/AZone",
  );
  assertExists(result.dueDate);
  // Falls back to UTC: reference is 2026-03-24, tomorrow is 2026-03-25.
  assertEquals(result.dueDate, "2026-03-25T00:00:00.000Z");
});

Deno.test("extractDueDate: impossible calendar date returns null", () => {
  // February 30 does not exist -> no due date, text left intact.
  const result = extractDueDate(
    "Submit report deadline: February 30",
    REFERENCE_DATE,
  );
  assertEquals(result.dueDate, null);
});
