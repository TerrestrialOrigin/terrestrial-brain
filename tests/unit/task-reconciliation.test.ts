import { assert, assertEquals } from "@std/assert";
import { computeSimilarity } from "../../supabase/functions/terrestrial-brain-mcp/extractors/similarity.ts";
import {
  greedyMatch,
  reconcileCheckboxesForTest,
  type ScoredPair,
  stripMarkersForComparison,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/task-reconciliation.ts";
import { extractAssignment } from "../../supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts";

// Pure, deterministic reconciliation-helper unit tests. No DB, no network, no
// LLM. Covers the exported greedyMatch assignment helper, the LCS prefilter
// equivalence, and the similarity/containment threshold boundaries.
// See fix-plan Step 19 / finding X3.

// ---------------------------------------------------------------------------
// greedyMatch — one-to-one, highest-score-first assignment
// ---------------------------------------------------------------------------

Deno.test("greedyMatch: highest-scoring pair wins a contested task", () => {
  const pairs: ScoredPair[] = [
    { checkboxIndex: 0, taskId: "task-a", score: 0.90 },
    { checkboxIndex: 1, taskId: "task-a", score: 0.95 },
  ];
  const accepted = greedyMatch(pairs, 0.8);
  assertEquals(accepted.length, 1);
  assertEquals(accepted[0].checkboxIndex, 1);
  assertEquals(accepted[0].taskId, "task-a");
});

Deno.test("greedyMatch: a checkbox is matched at most once", () => {
  const pairs: ScoredPair[] = [
    { checkboxIndex: 0, taskId: "task-a", score: 0.95 },
    { checkboxIndex: 0, taskId: "task-b", score: 0.90 },
  ];
  const accepted = greedyMatch(pairs, 0.8);
  assertEquals(accepted.length, 1);
  assertEquals(accepted[0].taskId, "task-a");
});

Deno.test("greedyMatch: below-threshold pairs are excluded", () => {
  const pairs: ScoredPair[] = [
    { checkboxIndex: 0, taskId: "task-a", score: 0.79 },
  ];
  const accepted = greedyMatch(pairs, 0.8);
  assertEquals(accepted.length, 0);
});

Deno.test("greedyMatch: threshold boundary is inclusive", () => {
  const pairs: ScoredPair[] = [
    { checkboxIndex: 0, taskId: "task-a", score: 0.8 },
  ];
  const accepted = greedyMatch(pairs, 0.8);
  assertEquals(accepted.length, 1);
});

Deno.test("greedyMatch: disjoint pairs are all accepted", () => {
  const pairs: ScoredPair[] = [
    { checkboxIndex: 0, taskId: "task-a", score: 0.90 },
    { checkboxIndex: 1, taskId: "task-b", score: 0.85 },
    { checkboxIndex: 2, taskId: "task-c", score: 0.82 },
  ];
  const accepted = greedyMatch(pairs, 0.8);
  assertEquals(accepted.length, 3);
});

Deno.test("greedyMatch: empty input returns empty result", () => {
  assertEquals(greedyMatch([], 0.8), []);
});

// ---------------------------------------------------------------------------
// computeSimilarity — threshold boundary behavior (0.8 pass)
// ---------------------------------------------------------------------------

Deno.test("computeSimilarity: near-identical strings clear the 0.8 similarity threshold", () => {
  // "Review the deployment plan" vs "Review the deployment plans" — one char
  // added; LCS/maxLen must stay >= 0.8.
  const score = computeSimilarity(
    "Review the deployment plan",
    "Review the deployment plans",
  );
  assert(score >= 0.8, `expected >= 0.8, got ${score}`);
});

Deno.test("computeSimilarity: unrelated strings fall below the 0.8 threshold", () => {
  const score = computeSimilarity("Buy groceries", "Fix the login page");
  assert(score < 0.8, `expected < 0.8, got ${score}`);
});

// ---------------------------------------------------------------------------
// stripMarkersForComparison — annotation removal before scoring
// ---------------------------------------------------------------------------

Deno.test("stripMarkersForComparison: removes assignment and deadline markers", () => {
  const stripped = stripMarkersForComparison(
    "Fix the login bug (assigned: Alice) (deadline: March 30)",
  );
  assertEquals(stripped, "Fix the login bug");
});

Deno.test("stripMarkersForComparison: leaves unannotated text unchanged", () => {
  assertEquals(
    stripMarkersForComparison("Write the release notes"),
    "Write the release notes",
  );
});

// ---------------------------------------------------------------------------
// extractAssignment — explicit (assigned:)/(owner:) fast path
// ---------------------------------------------------------------------------

Deno.test("extractAssignment: assigned marker strips and returns personId", () => {
  const people = [{ id: "p1", name: "Alice" }];
  const result = extractAssignment("Fix bug (assigned: Alice)", people);
  assertEquals(result.personId, "p1");
  assertEquals(result.cleanedText, "Fix bug");
});

Deno.test("extractAssignment: owner marker variant works", () => {
  const people = [{ id: "p2", name: "Bob" }];
  const result = extractAssignment("Ship release (owner: Bob)", people);
  assertEquals(result.personId, "p2");
  assertEquals(result.cleanedText, "Ship release");
});

Deno.test("extractAssignment: no marker returns null and original text", () => {
  const people = [{ id: "p1", name: "Alice" }];
  const result = extractAssignment("Fix bug", people);
  assertEquals(result.personId, null);
  assertEquals(result.cleanedText, "Fix bug");
});

// ---------------------------------------------------------------------------
// Prefilter equivalence — prefiltered reconciler == brute-force full-LCS
// ---------------------------------------------------------------------------

Deno.test("reconcileCheckboxesForTest: prefilters do not change the matched set", () => {
  const checkboxes = [
    "Review the deployment plan",
    "Fix the login bug (assigned: Alice)",
    "Completely unrelated brand new task",
    "Write the release notes for v2",
  ];
  const knownTasks = [
    { id: "t1", content: "Review the deployment plan", reference_id: null },
    { id: "t2", content: "Fix the login bug", reference_id: null },
    { id: "t3", content: "Some ancient task nobody edits", reference_id: null },
    { id: "t4", content: "Write the release notes for v2", reference_id: null },
  ];

  const withPrefilter = reconcileCheckboxesForTest(
    checkboxes,
    knownTasks,
    true,
  );
  const bruteForce = reconcileCheckboxesForTest(checkboxes, knownTasks, false);

  // Compare matched sets as sorted (checkboxIndex -> taskId) tuples.
  const key = (
    matched: { checkboxIndex: number; existingTaskId: string }[],
  ) =>
    matched
      .map((match) => `${match.checkboxIndex}:${match.existingTaskId}`)
      .sort()
      .join(",");

  assertEquals(key(withPrefilter.matched), key(bruteForce.matched));
  assertEquals(
    [...withPrefilter.unmatchedCheckboxIndices].sort(),
    [...bruteForce.unmatchedCheckboxIndices].sort(),
  );
  assertEquals(
    [...withPrefilter.unmatchedTaskIds].sort(),
    [...bruteForce.unmatchedTaskIds].sort(),
  );
});
