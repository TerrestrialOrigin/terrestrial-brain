// Section-body formatting that distinguishes "empty" from "broken" (fix-plan
// Step 10, finding C9). Composite-query handlers destructure only `{ data }` and
// drop `{ error }`, so a failed sub-query renders identically to a genuinely
// empty result ("No open tasks."). `renderSectionBody` makes the two render
// differently: a failed query is logged and shown as an explicit unavailable
// marker; a successful-empty query shows its normal empty-state prose.

/**
 * Inline marker for a single failed auxiliary value (a count, a name) inside an
 * otherwise-successful entity read — the value-level sibling of the
 * `(section unavailable: …)` section marker. A failed count must never render
 * as `0` (TOOL-4).
 */
export const UNAVAILABLE_MARKER = "? (lookup failed)";

/** The `{ data, error }` shape returned by a supabase-js query. */
export interface SupabaseResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

/**
 * Choose a section's body text:
 * - query errored  → `(section unavailable: <reason>)`, and the error is logged
 * - succeeded, 0 rows → the caller's empty-state text
 * - succeeded, rows → the caller's rendered rows
 *
 * `context` labels the log line so a failure is traceable to the section.
 */
export function renderSectionBody<Row>(
  result: SupabaseResult<Row>,
  emptyText: string,
  renderRows: (rows: Row[]) => string,
  context: string,
): string {
  if (result.error) {
    console.error(`${context} query failed: ${result.error.message}`);
    return `(section unavailable: ${result.error.message})`;
  }
  const rows = result.data ?? [];
  if (rows.length === 0) return emptyText;
  return renderRows(rows);
}
