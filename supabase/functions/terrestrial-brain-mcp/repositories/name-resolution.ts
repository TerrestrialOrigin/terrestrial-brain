/**
 * Generic id → display-name resolution (fix-plan Step 16, findings X1/X2).
 *
 * One batched `IN` query replacing the four hand-copied name-resolution blocks
 * in `tasks.ts` (project, person, and parent-task lookups) and the body of
 * `resolveProjectNames`. On a lookup error it logs and falls back to a raw
 * id → id map (never a silently empty map that would hide the failure —
 * finding C9); on success it maps only the rows that were found (callers guard
 * their render with `map.get(id)`), matching the prior inline behavior exactly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves `ids` to a `Map<id, displayValue>` via a single query against
 * `table`, reading `nameColumn` (default `"name"`; pass `"content"` for tasks).
 */
export async function resolveNames(
  supabase: SupabaseClient,
  table: string,
  ids: string[],
  nameColumn: string = "name",
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (ids.length === 0) return nameMap;

  const uniqueIds = [...new Set(ids)];
  // A dynamic `nameColumn` defeats supabase-js's compile-time select parsing, so
  // pin the row shape explicitly with `.returns<T>()` (id plus the requested
  // column, both text).
  const { data, error } = await supabase
    .from(table)
    .select(`id, ${nameColumn}`)
    .in("id", uniqueIds)
    .returns<Array<{ id: string; [column: string]: string }>>();

  if (error) {
    console.error(`Name resolution for ${table} failed: ${error.message}`);
    for (const id of uniqueIds) nameMap.set(id, id);
    return nameMap;
  }

  for (const row of data || []) {
    nameMap.set(row.id, row[nameColumn]);
  }
  return nameMap;
}
