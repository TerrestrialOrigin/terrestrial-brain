/**
 * SupabaseAiOutputRepository — the sole implementation of `AiOutputRepository`
 * (fix-plan Step 17). Every `ai_output` table query formerly inline in
 * `tools/ai_output.ts` lives here.
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { PENDING_METADATA_LIMIT } from "../constants.ts";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  AiOutputRepository,
  NewAiOutputValues,
  PendingAiOutputRow,
} from "./ai-output-repository.ts";

export class SupabaseAiOutputRepository implements AiOutputRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

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
      .order("created_at", { ascending: true })
      // Bounded — never stream the whole pending set (incl. full content).
      .limit(PENDING_METADATA_LIMIT);
    if (data && data.length === PENDING_METADATA_LIMIT) {
      console.warn(
        `listPending hit the ${PENDING_METADATA_LIMIT}-row cap — more pending output may exist`,
      );
    }
    return { data, error: toRepoError(error) };
  }

  async listPendingMetadata(): Promise<RepoResult<unknown[]>> {
    // Pass an explicit bound so truncation is deliberate, not PostgREST's silent
    // 1000-row cap; log when exactly the cap returns (possible truncation).
    const { data, error } = await this.supabase
      .rpc("get_pending_ai_output_metadata", {
        max_rows: PENDING_METADATA_LIMIT,
      });
    if (data && data.length === PENDING_METADATA_LIMIT) {
      console.warn(
        `get_pending_ai_output_metadata returned exactly ${PENDING_METADATA_LIMIT} rows — more pending output may exist`,
      );
    }
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
    // Claim-style: only stamp rows not already picked up, so an at-least-once
    // client retry is a no-op and never advances `picked_up_at` (which would
    // re-surface an already-reported delivery in `get_recent_activity`).
    const { error } = await this.supabase
      .from("ai_output")
      .update({ picked_up: true, picked_up_at: new Date().toISOString() })
      .in("id", ids)
      .eq("picked_up", false);
    return { data: null, error: toRepoError(error) };
  }

  async reject(ids: string[]): Promise<RepoResult<void>> {
    // Claim-style: only stamp rows not already rejected, so a retried rejection
    // does not re-stamp `rejected_at`.
    const { error } = await this.supabase
      .from("ai_output")
      .update({ rejected: true, rejected_at: new Date().toISOString() })
      .in("id", ids)
      .eq("rejected", false);
    return { data: null, error: toRepoError(error) };
  }
}
