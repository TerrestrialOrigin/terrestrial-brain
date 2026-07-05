/**
 * Repository result envelope (fix-plan Step 16, finding X2).
 *
 * Repository methods return this narrow `{ data, error }` shape rather than
 * throwing, so tool handlers keep their existing error-surfacing (finding C9)
 * with no try/catch churn. It deliberately mirrors the slice of supabase-js's
 * response that handlers already destructure — including the postgrest `code`,
 * so a single-row "no rows" miss (`PGRST116`) stays distinguishable from a real
 * failure exactly as before. A fake repository can construct these by hand,
 * which is the property the seam exists to provide.
 */

export interface RepoError {
  message: string;
  /** Postgrest error code, e.g. `PGRST116` for a single-row "no rows" miss. */
  code?: string;
}

export interface RepoResult<Data> {
  data: Data | null;
  error: RepoError | null;
}

/**
 * Narrows a supabase-js error (or null) into a `RepoError`, preserving the
 * postgrest `code` so single-row "no rows" misses stay recognizable. Shared by
 * every repository implementation.
 */
export function toRepoError(
  error: { message: string; code?: string } | null,
): RepoError | null {
  if (!error) return null;
  return error.code !== undefined
    ? { message: error.message, code: error.code }
    : { message: error.message };
}
