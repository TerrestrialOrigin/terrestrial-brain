/**
 * SupabaseNoteSnapshotRepository — the sole implementation of
 * `NoteSnapshotRepository` (fix-plan Step 17). The two `note_snapshots` writes
 * formerly inline in `handleIngestNote` live here.
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  NoteSnapshotRepository,
  NoteSnapshotUpsert,
} from "./note-snapshot-repository.ts";

export class SupabaseNoteSnapshotRepository implements NoteSnapshotRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  async findContentByReference(
    referenceId: string,
  ): Promise<RepoResult<{ content: string }>> {
    const { data, error } = await this.supabase
      .from("note_snapshots")
      .select("content")
      .eq("reference_id", referenceId)
      .single();
    return { data, error: toRepoError(error) };
  }

  async upsert(
    values: NoteSnapshotUpsert,
  ): Promise<RepoResult<{ id: string }>> {
    const { data, error } = await this.supabase
      .from("note_snapshots")
      .upsert(values, { onConflict: "reference_id" })
      .select("id")
      .single();
    return { data, error: toRepoError(error) };
  }

  async findIdByReference(
    referenceId: string,
  ): Promise<RepoResult<{ id: string } | null>> {
    // maybeSingle → data is null (not a PGRST116 error) when no row exists, so
    // forgetting an unsynced note is an idempotent no-op.
    const { data, error } = await this.supabase
      .from("note_snapshots")
      .select("id")
      .eq("reference_id", referenceId)
      .maybeSingle();
    return { data, error: toRepoError(error) };
  }

  async deleteByReference(referenceId: string): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("note_snapshots")
      .delete()
      .eq("reference_id", referenceId);
    return { data: null, error: toRepoError(error) };
  }
}
