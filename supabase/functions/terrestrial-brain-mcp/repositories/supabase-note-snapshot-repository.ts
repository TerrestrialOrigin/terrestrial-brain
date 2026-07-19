/**
 * SupabaseNoteSnapshotRepository — the sole implementation of
 * `NoteSnapshotRepository` (fix-plan Step 17). The two `note_snapshots` writes
 * formerly inline in `handleIngestNote` live here. Each method delegates its
 * await-then-wrap to the shared `runQuery` / `runWrite` helpers (REPO-3).
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { type RepoResult, runQuery, runWrite } from "./repo-result.ts";
import type {
  NoteSnapshotRepository,
  NoteSnapshotUpsert,
} from "./note-snapshot-repository.ts";

export class SupabaseNoteSnapshotRepository implements NoteSnapshotRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  findContentByReference(
    referenceId: string,
  ): Promise<RepoResult<{ content: string }>> {
    return runQuery(
      this.supabase
        .from("note_snapshots")
        .select("content")
        .eq("reference_id", referenceId)
        .single(),
    );
  }

  upsert(
    values: NoteSnapshotUpsert,
  ): Promise<RepoResult<{ id: string }>> {
    return runQuery(
      this.supabase
        .from("note_snapshots")
        .upsert(values, { onConflict: "reference_id" })
        .select("id")
        .single(),
    );
  }

  findIdByReference(
    referenceId: string,
  ): Promise<RepoResult<{ id: string } | null>> {
    // maybeSingle → data is null (not a PGRST116 error) when no row exists, so
    // forgetting an unsynced note is an idempotent no-op.
    return runQuery(
      this.supabase
        .from("note_snapshots")
        .select("id")
        .eq("reference_id", referenceId)
        .maybeSingle(),
    );
  }

  deleteByReference(referenceId: string): Promise<RepoResult<void>> {
    return runWrite(
      this.supabase
        .from("note_snapshots")
        .delete()
        .eq("reference_id", referenceId),
    );
  }
}
