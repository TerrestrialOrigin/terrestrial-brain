/**
 * Shared marker vocabulary for task metadata.
 *
 * Due-date markers ("due", "by", "deadline", "before") and assignment markers
 * ("assigned", "owner", "assignee") are used by both the date parser and the
 * task extractor. Defining them once here — rather than re-hardcoding the same
 * alternation in each file — keeps the vocabulary from drifting apart.
 *
 * The derived `*_MARKER_PATTERN` strings are non-capturing regex alternations
 * (e.g. `(?:due|by|deadline|before)`) suitable for interpolation into a larger
 * `RegExp`.
 */

/** Words that introduce a due date, e.g. "due March 30", "by Friday". */
export const DUE_MARKERS = ["due", "by", "deadline", "before"] as const;

/** Words that introduce a person assignment, e.g. "(assigned: Alice)". */
export const ASSIGNMENT_MARKERS = ["assigned", "owner", "assignee"] as const;

/** Non-capturing alternation of the due-date markers. */
export const DUE_MARKER_PATTERN = `(?:${DUE_MARKERS.join("|")})`;

/** Non-capturing alternation of the assignment markers. */
export const ASSIGNMENT_MARKER_PATTERN = `(?:${ASSIGNMENT_MARKERS.join("|")})`;
