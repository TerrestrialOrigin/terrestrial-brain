/**
 * Task reconciliation — matches note checkboxes against existing tasks on
 * re-ingest (split from task-extractor.ts, EXTR-12).
 *
 * Two-pass: high-similarity matching first, then a containment fallback that
 * catches edits where the user appended metadata to an existing task's text.
 * Both passes feed scored candidate pairs through the shared greedy one-to-one
 * assignment helper.
 */

import type { ParsedCheckbox } from "../parser.ts";
import type { KnownTask } from "./pipeline.ts";
import {
  CONTAINMENT_THRESHOLD,
  scoreContainmentPair,
  scoreSimilarityPair,
  SIMILARITY_THRESHOLD,
} from "./similarity.ts";
import { ASSIGNMENT_MARKER_PATTERN, DUE_MARKER_PATTERN } from "./markers.ts";
import { monthPattern } from "./date-parser.ts";

// ---------------------------------------------------------------------------
// Greedy one-to-one assignment (shared by both reconciliation passes)
// ---------------------------------------------------------------------------

export interface ScoredPair {
  checkboxIndex: number;
  taskId: string;
  score: number;
}

/**
 * Accepts scored checkbox↔task candidate pairs greedily in descending score
 * order, skipping any pair below `threshold` and any pair whose checkbox index
 * or task id has already been taken. The result is strictly one-to-one: no
 * checkbox and no task appears in more than one accepted pair. Both the
 * similarity and containment reconciliation passes use this single helper.
 */
export function greedyMatch(
  pairs: ScoredPair[],
  threshold: number,
): ScoredPair[] {
  const ranked = pairs
    .filter((pair) => pair.score >= threshold)
    .sort((pairA, pairB) => pairB.score - pairA.score);

  const takenCheckboxIndices = new Set<number>();
  const takenTaskIds = new Set<string>();
  const accepted: ScoredPair[] = [];

  for (const pair of ranked) {
    if (
      takenCheckboxIndices.has(pair.checkboxIndex) ||
      takenTaskIds.has(pair.taskId)
    ) continue;
    accepted.push(pair);
    takenCheckboxIndices.add(pair.checkboxIndex);
    takenTaskIds.add(pair.taskId);
  }

  return accepted;
}

// ---------------------------------------------------------------------------
// Task reconciliation (two-pass: similarity + containment fallback)
// ---------------------------------------------------------------------------

export interface TaskMatch {
  existingTaskId: string;
  checkboxIndex: number;
  similarity: number;
}

/**
 * Strips common metadata markers from checkbox text so reconciliation
 * compares apples-to-apples against stored (already-cleaned) content.
 * E.g. "Fix bug (assigned: Alice) (deadline: March 30)" → "Fix bug"
 */
export function stripMarkersForComparison(text: string): string {
  // A marker must be a standalone word (leading `\b`), and the bare-form markers
  // must be separated from their value by a colon or whitespace — never matched
  // mid-word or against an arbitrary `\w+` (EXTR-1). The month-name alternation
  // replaces the over-broad `\w+` so "Review by section 3" is left unchanged.
  const separator = "(?:\\s*:\\s*|\\s+)";
  return text
    .replace(
      new RegExp(`\\(\\s*\\b${ASSIGNMENT_MARKER_PATTERN}\\s*:[^)]*\\)`, "gi"),
      "",
    )
    .replace(
      new RegExp(`\\(\\s*\\b${DUE_MARKER_PATTERN}\\s*:?[^)]*\\)`, "gi"),
      "",
    )
    .replace(
      new RegExp(
        `(?:,?\\s*)\\b${DUE_MARKER_PATTERN}${separator}\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}`,
        "gi",
      ),
      "",
    )
    .replace(
      new RegExp(
        `(?:,?\\s*)\\b${DUE_MARKER_PATTERN}${separator}(?:${monthPattern})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
        "gi",
      ),
      "",
    )
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface ReconcileResult {
  matched: TaskMatch[];
  unmatchedCheckboxIndices: number[];
  unmatchedTaskIds: string[];
}

/** Pass 1: high-similarity matches (LCS/maxLength >= SIMILARITY_THRESHOLD). */
function matchBySimilarity(
  cleanedCheckboxTexts: string[],
  knownTasks: KnownTask[],
  usePrefilter: boolean,
): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  for (
    let checkboxIndex = 0;
    checkboxIndex < cleanedCheckboxTexts.length;
    checkboxIndex++
  ) {
    for (const task of knownTasks) {
      const score = scoreSimilarityPair(
        cleanedCheckboxTexts[checkboxIndex],
        task.content,
        usePrefilter,
      );
      if (score !== null && score >= SIMILARITY_THRESHOLD) {
        pairs.push({ checkboxIndex, taskId: task.id, score });
      }
    }
  }
  return greedyMatch(pairs, SIMILARITY_THRESHOLD);
}

/**
 * Pass 2: containment fallback (LCS/minLength >= CONTAINMENT_THRESHOLD).
 * Catches edits where the user adds metadata like "(assigned: Alice)" to an
 * existing task — the original text is fully contained in the new text.
 */
function matchByContainment(
  cleanedCheckboxTexts: string[],
  remainingCheckboxIndices: number[],
  remainingTasks: KnownTask[],
  usePrefilter: boolean,
): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  for (const checkboxIndex of remainingCheckboxIndices) {
    for (const task of remainingTasks) {
      const score = scoreContainmentPair(
        cleanedCheckboxTexts[checkboxIndex],
        task.content,
        usePrefilter,
      );
      if (score !== null && score >= CONTAINMENT_THRESHOLD) {
        pairs.push({ checkboxIndex, taskId: task.id, score });
      }
    }
  }
  return greedyMatch(pairs, CONTAINMENT_THRESHOLD);
}

export function reconcileCheckboxes(
  checkboxes: ParsedCheckbox[],
  knownTasks: KnownTask[],
  usePrefilter = true,
): ReconcileResult {
  if (knownTasks.length === 0) {
    return {
      matched: [],
      unmatchedCheckboxIndices: checkboxes.map((_, index) => index),
      unmatchedTaskIds: [],
    };
  }

  // Pre-clean checkbox text for comparison: strip metadata markers so
  // similarity is computed against core task content, not annotations.
  // Stored task content is already cleaned, so we clean checkbox text to match.
  const cleanedCheckboxTexts = checkboxes.map(
    (checkbox) => stripMarkersForComparison(checkbox.text),
  );

  const matchedCheckboxIndices = new Set<number>();
  const matchedTaskIds = new Set<string>();
  const matched: TaskMatch[] = [];

  const record = (pair: ScoredPair) => {
    matched.push({
      existingTaskId: pair.taskId,
      checkboxIndex: pair.checkboxIndex,
      similarity: pair.score,
    });
    matchedCheckboxIndices.add(pair.checkboxIndex);
    matchedTaskIds.add(pair.taskId);
  };

  for (
    const pair of matchBySimilarity(
      cleanedCheckboxTexts,
      knownTasks,
      usePrefilter,
    )
  ) record(pair);

  const remainingCheckboxIndices = checkboxes
    .map((_, index) => index)
    .filter((index) => !matchedCheckboxIndices.has(index));
  const remainingTasks = knownTasks
    .filter((task) => !matchedTaskIds.has(task.id));

  if (remainingCheckboxIndices.length > 0 && remainingTasks.length > 0) {
    for (
      const pair of matchByContainment(
        cleanedCheckboxTexts,
        remainingCheckboxIndices,
        remainingTasks,
        usePrefilter,
      )
    ) record(pair);
  }

  return {
    matched,
    unmatchedCheckboxIndices: checkboxes
      .map((_, index) => index)
      .filter((index) => !matchedCheckboxIndices.has(index)),
    unmatchedTaskIds: knownTasks
      .map((task) => task.id)
      .filter((taskId) => !matchedTaskIds.has(taskId)),
  };
}

/**
 * Test-only seam: reconcile from bare checkbox text strings with the prefilter
 * toggle exposed, so a unit test can assert the prefiltered result equals the
 * brute-force (full-LCS) result. Not used in production code paths.
 */
export function reconcileCheckboxesForTest(
  checkboxTexts: string[],
  knownTasks: KnownTask[],
  usePrefilter: boolean,
): ReconcileResult {
  const checkboxes: ParsedCheckbox[] = checkboxTexts.map((text, index) => ({
    text,
    checked: false,
    depth: 0,
    lineNumber: index,
    parentIndex: null,
    sectionHeading: null,
  }));
  return reconcileCheckboxes(checkboxes, knownTasks, usePrefilter);
}
