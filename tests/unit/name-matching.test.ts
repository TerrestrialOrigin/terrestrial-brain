import { assertEquals } from "@std/assert";
import {
  findPersonByName,
  findPersonInText,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/name-matching.ts";
import type { KnownPerson } from "../../supabase/functions/terrestrial-brain-mcp/extractors/name-matching.ts";

// Pure/deterministic name-matching unit tests. Relocated from the in-source
// vitest file (following the Step 5 test-suite split) and rewritten as native
// Deno tests so they run under `deno task test`. Extended for finding C5
// (fix-plan Step 7): tier-1 full-name matching must enforce word boundaries.

const people: KnownPerson[] = [
  { id: "id-bub", name: "Bub Goodwin" },
  { id: "id-alice", name: "Alice Cooper" },
  { id: "id-al", name: "Al Green" },
];

// ─── findPersonByName ───────────────────────────────────────────────────────

Deno.test("findPersonByName: returns exact match (case-insensitive)", () => {
  assertEquals(findPersonByName("Bub Goodwin", people), "id-bub");
  assertEquals(findPersonByName("bub goodwin", people), "id-bub");
  assertEquals(findPersonByName("BUB GOODWIN", people), "id-bub");
});

Deno.test("findPersonByName: returns single partial match on first name", () => {
  assertEquals(findPersonByName("Bub", people), "id-bub");
});

Deno.test("findPersonByName: returns single partial match on last name", () => {
  assertEquals(findPersonByName("Goodwin", people), "id-bub");
});

Deno.test("findPersonByName: partial match is case-insensitive", () => {
  assertEquals(findPersonByName("goodwin", people), "id-bub");
  assertEquals(findPersonByName("GOODWIN", people), "id-bub");
});

Deno.test("findPersonByName: returns null for ambiguous partial match", () => {
  const peopleWithDuplicate: KnownPerson[] = [
    { id: "id-john-s", name: "John Smith" },
    { id: "id-john-d", name: "John Doe" },
  ];
  assertEquals(findPersonByName("John", peopleWithDuplicate), null);
});

Deno.test("findPersonByName: returns null for unknown name with no partial match", () => {
  assertEquals(findPersonByName("Charlie", people), null);
});

Deno.test("findPersonByName: ignores name parts shorter than 2 characters", () => {
  const peopleWithShort: KnownPerson[] = [{
    id: "id-j-smith",
    name: "J Smith",
  }];
  assertEquals(findPersonByName("J", peopleWithShort), null);
});

Deno.test("findPersonByName: returns null for empty candidate name", () => {
  assertEquals(findPersonByName("", people), null);
  assertEquals(findPersonByName("   ", people), null);
});

Deno.test("findPersonByName: returns null for empty known people list", () => {
  assertEquals(findPersonByName("Bub", []), null);
});

Deno.test("findPersonByName: exact match takes priority over partial", () => {
  const peopleWithExact: KnownPerson[] = [
    { id: "id-alice-exact", name: "Alice" },
    { id: "id-alice-cooper", name: "Alice Cooper" },
  ];
  assertEquals(findPersonByName("Alice", peopleWithExact), "id-alice-exact");
});

Deno.test("findPersonByName: matches short names (2 chars) via partial", () => {
  assertEquals(findPersonByName("Al", people), "id-al");
});

// ─── findPersonInText ───────────────────────────────────────────────────────

Deno.test("findPersonInText: returns full-name match in text", () => {
  assertEquals(findPersonInText("Review Bub Goodwin's PR", people), "id-bub");
});

Deno.test("findPersonInText: returns earliest full-name match when multiple present", () => {
  assertEquals(
    findPersonInText("Alice Cooper and Bub Goodwin discussed", people),
    "id-alice",
  );
});

Deno.test("findPersonInText: returns partial match on first name when unambiguous", () => {
  assertEquals(findPersonInText("Ask Bub about the deploy", people), "id-bub");
});

Deno.test("findPersonInText: returns partial match on last name when unambiguous", () => {
  assertEquals(findPersonInText("Goodwin will handle this", people), "id-bub");
});

Deno.test("findPersonInText: returns null for ambiguous partial name in text", () => {
  const peopleWithDuplicate: KnownPerson[] = [
    { id: "id-john-s", name: "John Smith" },
    { id: "id-john-d", name: "John Doe" },
  ];
  assertEquals(findPersonInText("John will review", peopleWithDuplicate), null);
});

Deno.test("findPersonInText: full-name match takes priority over partial", () => {
  assertEquals(findPersonInText("Bub Goodwin mentioned it", people), "id-bub");
});

Deno.test("findPersonInText: returns null for empty text", () => {
  assertEquals(findPersonInText("", people), null);
});

Deno.test("findPersonInText: returns null for empty people list", () => {
  assertEquals(findPersonInText("Ask Bub", []), null);
});

Deno.test("findPersonInText: does not match partial names embedded in other words", () => {
  const peopleWithAl: KnownPerson[] = [{ id: "id-al", name: "Al Green" }];
  // "Al" appears inside "Also" — should not match.
  assertEquals(findPersonInText("Also check the logs", peopleWithAl), null);
});

Deno.test("findPersonInText: matches partial name at start of text", () => {
  assertEquals(findPersonInText("Bub said yes", people), "id-bub");
});

Deno.test("findPersonInText: matches partial name at end of text", () => {
  assertEquals(findPersonInText("talk to Bub", people), "id-bub");
});

// ─── C5: tier-1 full-name word boundaries ───────────────────────────────────

Deno.test("findPersonInText: does not match a single-word full name embedded in a longer word", () => {
  const peopleWithAnn: KnownPerson[] = [{ id: "id-ann", name: "Ann" }];
  // "Ann" appears inside "Planning" — tier 1 must not match it.
  assertEquals(findPersonInText("Planning the sprint", peopleWithAnn), null);
});

Deno.test("findPersonInText: does not match a single-word full name at the start of a word", () => {
  const peopleWithAnn: KnownPerson[] = [{ id: "id-ann", name: "Ann" }];
  // "Ann" at the start of "Announcement".
  assertEquals(findPersonInText("Announcement at noon", peopleWithAnn), null);
});

Deno.test("findPersonInText: matches a single-word full name adjacent to punctuation", () => {
  const peopleWithAnn: KnownPerson[] = [{ id: "id-ann", name: "Ann" }];
  assertEquals(findPersonInText("talk to Ann.", peopleWithAnn), "id-ann");
  assertEquals(findPersonInText("(Ann) owns this", peopleWithAnn), "id-ann");
  assertEquals(findPersonInText("Ann's PR is ready", peopleWithAnn), "id-ann");
});

Deno.test("findPersonInText: selects the earliest boundary-valid full-name occurrence", () => {
  const peopleWithAnn: KnownPerson[] = [{ id: "id-ann", name: "Ann" }];
  // First "Ann" is embedded in "Planning"; the standalone "Ann" later must match.
  assertEquals(
    findPersonInText("Planning with Ann today", peopleWithAnn),
    "id-ann",
  );
});

Deno.test("findPersonInText: matches an accented full name as a whole word", () => {
  const peopleWithJose: KnownPerson[] = [{ id: "id-jose", name: "José" }];
  assertEquals(findPersonInText("José reviewed it", peopleWithJose), "id-jose");
  assertEquals(findPersonInText("Ask José.", peopleWithJose), "id-jose");
});

Deno.test("findPersonInText: does not match an accented full name embedded in a longer word", () => {
  const peopleWithJose: KnownPerson[] = [{ id: "id-jose", name: "José" }];
  // "José" followed by the letter "l" is not a whole word.
  assertEquals(findPersonInText("Josély signed off", peopleWithJose), null);
});
