/**
 * Content similarity — text normalization, LCS, thresholds, and the cheap
 * prefilters that gate the O(len²) DP (split from task-extractor.ts, EXTR-12).
 *
 * Pure string functions with no dependencies on the other extractor modules;
 * task reconciliation builds its scored candidate pairs on top of these.
 */

// ---------------------------------------------------------------------------
// Content similarity
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function computeSimilarity(textA: string, textB: string): number {
  const normalizedA = normalizeText(textA);
  const normalizedB = normalizeText(textB);

  if (normalizedA === normalizedB) return 1.0;
  if (normalizedA.length === 0 || normalizedB.length === 0) return 0.0;

  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  const lcsLength = longestCommonSubsequenceLength(normalizedA, normalizedB);

  return lcsLength / maxLength;
}

function longestCommonSubsequenceLength(
  textA: string,
  textB: string,
): number {
  const lengthA = textA.length;
  const lengthB = textB.length;

  let previousRow = new Array(lengthB + 1).fill(0);
  let currentRow = new Array(lengthB + 1).fill(0);

  for (let indexA = 1; indexA <= lengthA; indexA++) {
    for (let indexB = 1; indexB <= lengthB; indexB++) {
      if (textA[indexA - 1] === textB[indexB - 1]) {
        currentRow[indexB] = previousRow[indexB - 1] + 1;
      } else {
        currentRow[indexB] = Math.max(
          previousRow[indexB],
          currentRow[indexB - 1],
        );
      }
    }
    [previousRow, currentRow] = [currentRow, previousRow];
    currentRow.fill(0);
  }

  return previousRow[lengthB];
}

export const SIMILARITY_THRESHOLD = 0.8;
export const CONTAINMENT_THRESHOLD = 0.85;
const MIN_CONTAINMENT_LENGTH = 10;

// ---------------------------------------------------------------------------
// LCS prefilters — cheap necessary conditions that gate the O(len²) DP
// ---------------------------------------------------------------------------

/**
 * Character-multiset overlap: Σ min(count_A(c), count_B(c)). The longest common
 * subsequence can never exceed this (every matched character must appear in
 * both strings), so it is a rigorous upper bound on LCS length — and therefore
 * a safe basis for pruning pairs that provably cannot clear a score threshold.
 * O(len) instead of the O(lenA × lenB) DP.
 */
function characterMultisetOverlap(textA: string, textB: string): number {
  const remaining = new Map<string, number>();
  for (const character of textA) {
    remaining.set(character, (remaining.get(character) ?? 0) + 1);
  }
  let overlap = 0;
  for (const character of textB) {
    const available = remaining.get(character) ?? 0;
    if (available > 0) {
      overlap++;
      remaining.set(character, available - 1);
    }
  }
  return overlap;
}

/**
 * Similarity score (LCS / maxLength) with prefilters. Returns null when the
 * pair provably cannot reach SIMILARITY_THRESHOLD, so the DP is skipped. Each
 * gate is a necessary condition, so the accepted set is identical to running
 * the full LCS on every pair.
 */
export function scoreSimilarityPair(
  cleanedCheckboxText: string,
  taskContent: string,
  usePrefilter: boolean,
): number | null {
  const normalizedCheckbox = normalizeText(cleanedCheckboxText);
  const normalizedTask = normalizeText(taskContent);
  if (normalizedCheckbox.length === 0 || normalizedTask.length === 0) {
    return null;
  }
  if (normalizedCheckbox === normalizedTask) return 1.0; // exact-match fast accept

  if (usePrefilter) {
    const maxLength = Math.max(
      normalizedCheckbox.length,
      normalizedTask.length,
    );
    // LCS ≤ min(len) and LCS ≤ characterMultisetOverlap → similarity upper bound.
    const lcsUpperBound = Math.min(
      Math.min(normalizedCheckbox.length, normalizedTask.length),
      characterMultisetOverlap(normalizedCheckbox, normalizedTask),
    );
    if (lcsUpperBound / maxLength < SIMILARITY_THRESHOLD) return null;
  }

  return computeSimilarity(cleanedCheckboxText, taskContent);
}

/**
 * Containment score (LCS / minLength) with prefilters. Returns null when the
 * shorter text is below MIN_CONTAINMENT_LENGTH, or when the pair provably
 * cannot reach CONTAINMENT_THRESHOLD.
 */
export function scoreContainmentPair(
  cleanedCheckboxText: string,
  taskContent: string,
  usePrefilter: boolean,
): number | null {
  const normalizedCheckbox = normalizeText(cleanedCheckboxText);
  const normalizedTask = normalizeText(taskContent);
  const minLength = Math.min(
    normalizedCheckbox.length,
    normalizedTask.length,
  );
  if (minLength < MIN_CONTAINMENT_LENGTH) return null;

  if (usePrefilter) {
    // LCS ≤ characterMultisetOverlap → containment upper bound.
    const lcsUpperBound = characterMultisetOverlap(
      normalizedCheckbox,
      normalizedTask,
    );
    if (lcsUpperBound / minLength < CONTAINMENT_THRESHOLD) return null;
  }

  const lcsLength = longestCommonSubsequenceLength(
    normalizedCheckbox,
    normalizedTask,
  );
  return lcsLength / minLength;
}
