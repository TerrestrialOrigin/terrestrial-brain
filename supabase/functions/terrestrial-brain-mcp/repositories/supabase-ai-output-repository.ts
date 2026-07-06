/**
 * SupabaseAiOutputRepository — the sole implementation of `AiOutputRepository`
 * (fix-plan Step 17). Every `ai_output` table query formerly inline in
 * `tools/ai_output.ts` lives here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  AiOutputRepository,
  NewAiOutputValues,
  PendingAiOutputRow,
} from "./ai-output-repository.ts";

export class SupabaseAiOutputRepository implements AiOutputRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async insert(
    values: NewAiOutputValues,
  ): Promise<RepoResult<{ id: string }>> {
    const { data, error } = await this.supabase
      .from("ai_output")
      .insert(values)
      .select("id")
      .single();
    return { data, error: toRepoError(error) };
  }

  async listPending(): Promise<RepoResult<PendingAiOutputRow[]>> {
    const { data, error } = await this.supabase
      .from("ai_output")
      .select("id, title, content, file_path, created_at")
      .eq("picked_up", false)
      .eq("rejected", false)
      .order("created_at", { ascending: true });
    return { data, error: toRepoError(error) };
  }

  async listPendingMetadata(): Promise<RepoResult<unknown[]>> {
    const { data, error } = await this.supabase
      .rpc("get_pending_ai_output_metadata");
    return { data, error: toRepoError(error) };
  }

  async findContentByIds(
    ids: string[],
  ): Promise<RepoResult<{ id: string; content: string }[]>> {
    const { data, error } = await this.supabase
      .from("ai_output")
      .select("id, content")
      .in("id", ids)
      .eq("picked_up", false)
      .eq("rejected", false);
    return { data, error: toRepoError(error) };
  }

  async markPickedUp(ids: string[]): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("ai_output")
      .update({ picked_up: true, picked_up_at: new Date().toISOString() })
      .in("id", ids);
    return { data: null, error: toRepoError(error) };
  }

  async reject(ids: string[]): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("ai_output")
      .update({ rejected: true, rejected_at: new Date().toISOString() })
      .in("id", ids);
    return { data: null, error: toRepoError(error) };
  }
}
