// TOOL-9 — the extracted thought formatters must reproduce the pre-refactor
// handler output byte-for-byte. Each expected string below replicates the
// original inline algorithm exactly for a fully-populated fixture and a
// minimal fixture, so drift in any shared block turns a test red.

import { assertEquals } from "@std/assert";
import {
  collectProjectUuids,
  formatCaptureConfirmation,
  formatListEntry,
  formatProvenance,
  formatSearchResult,
  formatThoughtDetailLines,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/thought-format.ts";

const PROJECT_UUID = "aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa";
const NAME_MAP = new Map([[PROJECT_UUID, "Apollo"]]);

function fullThought() {
  return {
    id: "thought-1",
    content: "The full content body",
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-02T11:00:00.000Z",
    reliability: "reliable",
    author: "claude-sonnet-5",
    metadata: {
      type: "idea",
      topics: ["alpha", "beta"],
      people: ["Ana", "Bo"],
      action_items: ["do x", "do y"],
      references: { projects: [PROJECT_UUID], tasks: ["task-9"] },
    },
  };
}

Deno.test("formatSearchResult matches the pre-refactor block exactly", () => {
  const rendered = formatSearchResult(
    { ...fullThought(), similarity: 0.876 },
    0,
    NAME_MAP,
  );
  assertEquals(
    rendered,
    [
      "--- Result 1 (87.6% match) ---",
      "ID: thought-1",
      "Captured: 2026-03-01T10:00:00.000Z",
      "Updated: 2026-03-02T11:00:00.000Z",
      "Type: idea",
      "Reliability: reliable | Author: claude-sonnet-5",
      "Topics: alpha, beta",
      "People: Ana, Bo",
      "Projects: Apollo",
      "Actions: do x; do y",
      "\nThe full content body",
    ].join("\n"),
  );
});

Deno.test("formatSearchResult minimal row omits every optional line", () => {
  const rendered = formatSearchResult(
    {
      id: "thought-2",
      content: "Bare",
      created_at: "2026-03-01T10:00:00.000Z",
      updated_at: null,
      reliability: null,
      author: null,
      metadata: {},
      similarity: 0.5,
    },
    1,
    new Map(),
  );
  assertEquals(
    rendered,
    [
      "--- Result 2 (50.0% match) ---",
      "ID: thought-2",
      "Captured: 2026-03-01T10:00:00.000Z",
      "Type: unknown",
      "\nBare",
    ].join("\n"),
  );
});

Deno.test("formatListEntry matches the pre-refactor block exactly", () => {
  const rendered = formatListEntry(fullThought(), 0, NAME_MAP);
  assertEquals(
    rendered,
    [
      "1. [2026-03-01T10:00:00.000Z] (idea - alpha, beta)",
      "   ID: thought-1",
      "   Updated: 2026-03-02T11:00:00.000Z",
      "   Reliability: reliable | Author: claude-sonnet-5",
      "   Projects: Apollo",
      "   The full content body",
    ].join("\n"),
  );
});

Deno.test("formatListEntry: null created_at renders 'unknown' and type '??' when absent", () => {
  const rendered = formatListEntry(
    {
      id: "thought-3",
      content: "Minimal",
      created_at: null,
      metadata: {},
    },
    2,
    new Map(),
  );
  assertEquals(
    rendered,
    ["3. [unknown] (??)", "   ID: thought-3", "   Minimal"].join("\n"),
  );
});

Deno.test("formatThoughtDetailLines matches the pre-refactor get_thought_by_id output", () => {
  const lines = formatThoughtDetailLines({
    ...fullThought(),
    reference_id: "notes/source.md",
  });
  assertEquals(lines, [
    "ID: thought-1",
    "Captured: 2026-03-01T10:00:00.000Z",
    "Updated: 2026-03-02T11:00:00.000Z",
    "Type: idea",
    "Source: notes/source.md",
    "Topics: alpha, beta",
    "People: Ana, Bo",
    "Actions: do x; do y",
    `Projects: ${PROJECT_UUID}`,
    "Tasks: task-9",
    "\nThe full content body",
  ]);
});

Deno.test("formatCaptureConfirmation matches the pre-refactor suffix format", () => {
  assertEquals(
    formatCaptureConfirmation(fullThought().metadata),
    "Captured as idea — alpha, beta | People: Ana, Bo | Actions: do x; do y",
  );
  assertEquals(formatCaptureConfirmation({}), "Captured as thought");
});

Deno.test("collectProjectUuids gathers refs across rows; formatProvenance handles single sides", () => {
  assertEquals(
    collectProjectUuids([
      { metadata: { references: { projects: [PROJECT_UUID] } } },
      { metadata: {} },
      { metadata: { references: { projects: ["second-uuid"] } } },
    ]),
    [PROJECT_UUID, "second-uuid"],
  );
  assertEquals(
    formatProvenance({ reliability: "reliable", author: null }),
    "Reliability: reliable",
  );
  assertEquals(
    formatProvenance({ reliability: null, author: "gpt" }),
    "Author: gpt",
  );
  assertEquals(formatProvenance({ reliability: null, author: null }), null);
});
