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

/**
 * Patch arbitrary columns on a thought row via the service-role REST surface.
 * Used to place a captured thought into a specific lifecycle state (e.g. an old
 * `created_at`, a set `last_retrieved_at`, or a `note_snapshot_id`) that the
 * capture path does not set directly — reusing the embedding the fake generated.
 */
export async function patchThought(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(restUrl(`thoughts?id=eq.${id}`), {
    method: "PATCH",
    headers: { ...serviceHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(`patchThought failed (${response.status}) for ${id}`);
  }
}

/** An ISO timestamp `days` in the past (for backdating `created_at`). */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Create a note_snapshot row (a "synced note") and return its id. */
export async function createNoteSnapshot(referenceId: string): Promise<string> {
  const response = await fetch(restUrl("note_snapshots"), {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      reference_id: referenceId,
      title: "lifecycle snapshot",
      content: "lifecycle snapshot content",
      source: "obsidian",
    }),
  });
  const rows = (await response.json()) as { id: string }[];
  if (!response.ok || !rows[0]?.id) {
    throw new Error(`createNoteSnapshot failed (${response.status})`);
  }
  return rows[0].id;
}

/** SHA-256 hex of `text` — must match the server's `hashContent` (helpers.ts). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Delete a note_snapshot row by id (fixture cleanup). */
export async function deleteNoteSnapshot(id: string): Promise<void> {
  const response = await fetch(restUrl(`note_snapshots?id=eq.${id}`), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  await response.body?.cancel();
}
