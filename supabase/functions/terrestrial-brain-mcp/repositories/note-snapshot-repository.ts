/**
 * NoteSnapshotRepository — the seam over the `note_snapshots` write path used by
 * `handleIngestNote` (fix-plan Step 17, finding X2): the unchanged-content skip
 * read and the reference-keyed upsert. The composite `note_snapshots` *reads* in
 * `tools/queries.ts` live on `QueryRepository` (they are read-only), so the two
 * consumers stay decoupled.
 */

import type { RepoResult } from "./repo-result.ts";

/** Values for upserting a note snapshot (keyed on `reference_id`). */
export interface NoteSnapshotUpsert {
  reference_id: string;
  title: string | null;
  content: string;
  source: string;
}

export interface NoteSnapshotRepository {
  /**
   * The content currently stored for a note reference, if any — used to skip
   * re-ingesting an unchanged note. "No rows" surfaces via the PGRST116 code.
   */
  findContentByReference(
    referenceId: string,
  ): Promise<RepoResult<{ content: string }>>;

  /** Upsert a snapshot on conflict of `reference_id`; returns the row id. */
  upsert(values: NoteSnapshotUpsert): Promise<RepoResult<{ id: string }>>;
}
