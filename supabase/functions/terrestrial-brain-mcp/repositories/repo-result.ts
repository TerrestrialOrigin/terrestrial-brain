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

/**
 * Awaits a supabase-js query builder (builders are PromiseLike) and wraps the
 * response into a `RepoResult` (REPO-3). This is the one await-then-wrap block
 * every repository read delegates to: on error, `data` is always null so a
 * broken read can never masquerade as a success shape.
 */
export async function runQuery<Data>(
  builder: PromiseLike<{
    data: Data | null;
    error: { message: string; code?: string } | null;
  }>,
): Promise<RepoResult<Data>> {
  const { data, error } = await builder;
  if (error) return { data: null, error: toRepoError(error) };
  return { data, error: null };
}

/**
 * Awaits a supabase-js write builder whose data is not used and wraps the
 * error channel into a `RepoResult<void>` (REPO-3).
 */
export async function runWrite(
  builder: PromiseLike<{ error: { message: string; code?: string } | null }>,
): Promise<RepoResult<void>> {
  const { error } = await builder;
  return { data: null, error: toRepoError(error) };
}

/**
 * Awaits a supabase-js `count: "exact", head: true` builder and wraps the
 * count into a `RepoResult<number>` (REPO-3). A failed count keeps `data`
 * null — `data: 0` alongside an error would make "broken" indistinguishable
 * from "genuinely zero" (REPO-7).
 */
export async function runCount(
  builder: PromiseLike<{
    count: number | null;
    error: { message: string; code?: string } | null;
  }>,
): Promise<RepoResult<number>> {
  const { count, error } = await builder;
  if (error) return { data: null, error: toRepoError(error) };
  return { data: count ?? 0, error: null };
}
