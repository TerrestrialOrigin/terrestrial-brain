// Shared REST helpers for the deterministic lifecycle tests.
//
// The lifecycle tests assert on DURABLE database state (row counts,
// `metadata.type`, `usefulness_score`, `archived_at`), not on transient tool
// prose (design Test Strategy). These helpers wrap the service-role PostgREST
// surface from `tests/helpers/mcp-client.ts` so each test file does not
// re-implement the same fetches (Rule of Three).

import { callTool, restUrl, serviceHeaders } from "../../helpers/mcp-client.ts";

export interface ThoughtRow {
  id: string;
  content: string;
  usefulness_score: number;
  metadata: Record<string, unknown> | null;
  archived_at: string | null;
}

const THOUGHT_COLUMNS = "id,content,usefulness_score,metadata,archived_at";

/** All active + archived thought rows whose content contains `marker`. */
export async function thoughtsByMarker(marker: string): Promise<ThoughtRow[]> {
  const response = await fetch(
    restUrl(
      `thoughts?content=ilike.*${encodeURIComponent(marker)}*` +
        `&select=${THOUGHT_COLUMNS}&order=created_at.asc`,
    ),
    { headers: serviceHeaders() },
  );
  return (await response.json()) as ThoughtRow[];
}

/** One thought row by id (or null). */
export async function thoughtById(id: string): Promise<ThoughtRow | null> {
  const response = await fetch(
    restUrl(`thoughts?id=eq.${id}&select=${THOUGHT_COLUMNS}`),
    { headers: serviceHeaders() },
  );
  const rows = (await response.json()) as ThoughtRow[];
  return rows[0] ?? null;
}

/**
 * Capture a thought via the real MCP tool and return the created row.
 * `marker` must appear in `content` so the row can be located and cleaned up.
 */
export async function captureThought(
  marker: string,
  content: string,
): Promise<ThoughtRow> {
  await callTool("capture_thought", { content });
  const rows = await thoughtsByMarker(marker);
  const created = rows[rows.length - 1];
  if (!created) {
    throw new Error(
      `captureThought: no thought row found for marker "${marker}" after capture`,
    );
  }
  return created;
}

/** Delete every thought whose content contains `marker` (fixture cleanup). */
export async function deleteThoughtsByMarker(marker: string): Promise<void> {
  const response = await fetch(
    restUrl(`thoughts?content=ilike.*${encodeURIComponent(marker)}*`),
    { method: "DELETE", headers: serviceHeaders() },
  );
  // Consume the body so Deno's op-sanitizer doesn't flag a leaked response.
  await response.body?.cancel();
}

/** A unique marker for a lifecycle test's fixtures. */
export function lifecycleMarker(slug: string): string {
  return `lifecycle-${slug}-${crypto.randomUUID()}`;
}
