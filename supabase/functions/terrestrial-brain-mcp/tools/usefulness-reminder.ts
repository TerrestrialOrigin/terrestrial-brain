// Single home for the usefulness-reminder text appended by thought-returning
// tools. Before Step 18 this existed as three near-identical copies: a "hard"
// builder + a "soft" builder in tools/thoughts.ts, and a terse one-line inline
// reminder duplicated in tools/queries.ts. They are consolidated here behind one
// tone-parameterized builder. The exact per-tone text is preserved verbatim so
// the tools' emitted output is byte-for-byte identical to the pre-refactor output.

export type UsefulnessTone = "hard" | "soft" | "terse";

// "hard" — required-action framing used by search_thoughts (a specific question
// was asked, so recording usefulness is mandatory).
const HARD_LINES = [
  "⚠️ REQUIRED BEFORE NEXT USER RESPONSE:",
  "1. Call record_useful_thoughts with IDs that contributed (or empty array).",
  "2. Scan these results for contradictions/outdated data — surface to user, do NOT archive silently.",
  "",
  "NEVER skip the record_useful_thoughts step (if no thoughts were found useful, pass in an empty array)! ALWAYS do the record_useful_thoughts step (if no thoughts were found useful, pass in an empty array)!!!",
];

// "soft" — gentler framing used by list_thoughts (browsing, so "none contributed"
// is common and expected).
const SOFT_LINES = [
  "⚠️ BEFORE NEXT USER RESPONSE:",
  "If any of these thoughts contributed to your response, call record_useful_thoughts with their IDs.",
  "If none contributed (e.g. you were just browsing), call record_useful_thoughts with an empty array to acknowledge the scan.",
  "",
  "Also scan for contradictions/outdated data — surface to user, do NOT archive silently.",
];

/**
 * Build the usefulness reminder for the given candidate thought ids in the
 * requested tone. The trailing candidate-id line differs per tone ("this search"
 * for hard, "this list" for soft, the one-liner for terse) — preserved exactly.
 */
export function buildUsefulnessReminder(
  thoughtIds: string[],
  tone: UsefulnessTone,
): string {
  switch (tone) {
    case "hard":
      return [
        ...HARD_LINES,
        `Candidate IDs from this search: ${JSON.stringify(thoughtIds)}`,
      ].join("\n");
    case "soft":
      return [
        ...SOFT_LINES,
        `Candidate IDs from this list: ${JSON.stringify(thoughtIds)}`,
      ].join("\n");
    case "terse":
      return `\n---\nReminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs: ${
        JSON.stringify(thoughtIds)
      }`;
  }
}

/**
 * Build the reminder wrapped as a results header (reminder + "--- Results ---"
 * separator). Only the hard/soft tones are used as headers.
 */
export function buildUsefulnessHeader(
  thoughtIds: string[],
  tone: Exclude<UsefulnessTone, "terse">,
): string {
  return `${buildUsefulnessReminder(thoughtIds, tone)}\n\n--- Results ---\n\n`;
}
