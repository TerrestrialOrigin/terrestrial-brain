/**
 * Escapes SQL LIKE/ILIKE pattern metacharacters in user-supplied search text so
 * the text matches literally instead of acting as a wildcard pattern.
 *
 * Without this, a bare `%` would match every row (finding 5.3), and `_`/`\`
 * would silently alter matches. The escaped result is meant to be interpolated
 * into a `%...%` pattern used with PostgREST's `.ilike()`/`.like()`, which apply
 * the SQL default escape character `\`.
 *
 * Order matters: the backslash MUST be escaped first, otherwise the backslashes
 * introduced for `%` and `_` would themselves be doubled.
 */
export function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
