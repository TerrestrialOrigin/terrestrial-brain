/**
 * SupabaseNoteSnapshotRepository — the sole implementation of
 * `NoteSnapshotRepository` (fix-plan Step 17). The two `note_snapshots` writes
 * formerly inline in `handleIngestNote` live here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  NoteSnapshotRepository,
  NoteSnapshotUpsert,
} from "./note-snapshot-repository.ts";

export class SupabaseNoteSnapshotRepository implements NoteSnapshotRepository {
  constructor(private readonly supabase: SupabaseClient) {}

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
}
