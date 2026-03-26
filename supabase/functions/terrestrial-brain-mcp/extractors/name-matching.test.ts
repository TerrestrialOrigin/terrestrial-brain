import { describe, it, expect } from "vitest";
import { findPersonByName, findPersonInText } from "./name-matching";
import type { KnownPerson } from "./name-matching";

// ─── findPersonByName ─────────────────────────────────────────────────────────

describe("findPersonByName", () => {
  const people: KnownPerson[] = [
    { id: "id-bub", name: "Bub Goodwin" },
    { id: "id-alice", name: "Alice Cooper" },
    { id: "id-al", name: "Al Green" },
  ];

  it("returns exact match (case-insensitive)", () => {
    expect(findPersonByName("Bub Goodwin", people)).toBe("id-bub");
    expect(findPersonByName("bub goodwin", people)).toBe("id-bub");
    expect(findPersonByName("BUB GOODWIN", people)).toBe("id-bub");
  });

  it("returns single partial match on first name", () => {
    expect(findPersonByName("Bub", people)).toBe("id-bub");
  });

  it("returns single partial match on last name", () => {
    expect(findPersonByName("Goodwin", people)).toBe("id-bub");
  });

  it("partial match is case-insensitive", () => {
    expect(findPersonByName("goodwin", people)).toBe("id-bub");
    expect(findPersonByName("GOODWIN", people)).toBe("id-bub");
  });

  it("returns null for ambiguous partial match", () => {
    const peopleWithDuplicate: KnownPerson[] = [
      { id: "id-john-s", name: "John Smith" },
      { id: "id-john-d", name: "John Doe" },
    ];
    expect(findPersonByName("John", peopleWithDuplicate)).toBeNull();
  });

  it("returns null for unknown name with no partial match", () => {
    expect(findPersonByName("Charlie", people)).toBeNull();
  });

  it("ignores name parts shorter than 2 characters", () => {
    const peopleWithShort: KnownPerson[] = [
      { id: "id-j-smith", name: "J Smith" },
    ];
    expect(findPersonByName("J", peopleWithShort)).toBeNull();
  });

  it("returns null for empty candidate name", () => {
    expect(findPersonByName("", people)).toBeNull();
    expect(findPersonByName("   ", people)).toBeNull();
  });

  it("returns null for empty known people list", () => {
    expect(findPersonByName("Bub", [])).toBeNull();
  });

  it("exact match takes priority over partial", () => {
    const peopleWithExact: KnownPerson[] = [
      { id: "id-alice-exact", name: "Alice" },
      { id: "id-alice-cooper", name: "Alice Cooper" },
    ];
    expect(findPersonByName("Alice", peopleWithExact)).toBe("id-alice-exact");
  });

  it("matches short names (2 chars) via partial", () => {
    expect(findPersonByName("Al", people)).toBe("id-al");
  });
});

// ─── findPersonInText ─────────────────────────────────────────────────────────

describe("findPersonInText", () => {
  const people: KnownPerson[] = [
    { id: "id-bub", name: "Bub Goodwin" },
    { id: "id-alice", name: "Alice Cooper" },
    { id: "id-al", name: "Al Green" },
  ];

  it("returns full-name match in text", () => {
    expect(findPersonInText("Review Bub Goodwin's PR", people)).toBe("id-bub");
  });

  it("returns earliest full-name match when multiple present", () => {
    expect(
      findPersonInText("Alice Cooper and Bub Goodwin discussed", people),
    ).toBe("id-alice");
  });

  it("returns partial match on first name when unambiguous", () => {
    expect(findPersonInText("Ask Bub about the deploy", people)).toBe(
      "id-bub",
    );
  });

  it("returns partial match on last name when unambiguous", () => {
    expect(findPersonInText("Goodwin will handle this", people)).toBe(
      "id-bub",
    );
  });

  it("returns null for ambiguous partial name in text", () => {
    const peopleWithDuplicate: KnownPerson[] = [
      { id: "id-john-s", name: "John Smith" },
      { id: "id-john-d", name: "John Doe" },
    ];
    expect(findPersonInText("John will review", peopleWithDuplicate)).toBeNull();
  });

  it("full-name match takes priority over partial", () => {
    expect(
      findPersonInText("Bub Goodwin mentioned it", people),
    ).toBe("id-bub");
  });

  it("returns null for empty text", () => {
    expect(findPersonInText("", people)).toBeNull();
  });

  it("returns null for empty people list", () => {
    expect(findPersonInText("Ask Bub", [])).toBeNull();
  });

  it("does not match partial names embedded in other words", () => {
    const peopleWithAl: KnownPerson[] = [
      { id: "id-al", name: "Al Green" },
    ];
    // "Al" appears inside "Also" — should not match
    expect(findPersonInText("Also check the logs", peopleWithAl)).toBeNull();
  });

  it("matches partial name at start of text", () => {
    expect(findPersonInText("Bub said yes", people)).toBe("id-bub");
  });

  it("matches partial name at end of text", () => {
    expect(findPersonInText("talk to Bub", people)).toBe("id-bub");
  });
});
