/**
 * SupabaseAiOutputRepository — the sole implementation of `AiOutputRepository`
 * (fix-plan Step 17). Every `ai_output` table query formerly inline in
 * `tools/ai_output.ts` lives here. Each method delegates its await-then-wrap
 * to the shared `runQuery` helper (REPO-3).
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { PENDING_METADATA_LIMIT } from "../constants.ts";
import { type RepoResult, runQuery } from "./repo-result.ts";
import type {
  AiOutputRepository,
  NewAiOutputValues,
  PendingAiOutputMetadataRow,
  PendingAiOutputRow,
} from "./ai-output-repository.ts";

export class SupabaseAiOutputRepository implements AiOutputRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  insert(
    values: NewAiOutputValues,
  ): Promise<RepoResult<{ id: string }>> {
    return runQuery(
      this.supabase
        .from("ai_output")
        .insert(values)
        .select("id")
        .single(),
    );
  }

  async listPending(): Promise<RepoResult<PendingAiOutputRow[]>> {
    const result = await runQuery(
      this.supabase
        .from("ai_output")
        .select("id, title, content, file_path, created_at")
        .eq("picked_up", false)
        .eq("rejected", false)
        .order("created_at", { ascending: true })
        // Bounded — never stream the whole pending set (incl. full content).
        .limit(PENDING_METADATA_LIMIT),
    );
    if (result.data && result.data.length === PENDING_METADATA_LIMIT) {
      console.warn(
        `listPending hit the ${PENDING_METADATA_LIMIT}-row cap — more pending output may exist`,
      );
    }
    return result;
  }

  async listPendingMetadata(): Promise<
    RepoResult<PendingAiOutputMetadataRow[]>
  > {
    // Pass an explicit bound so truncation is deliberate, not PostgREST's silent
    // 1000-row cap; log when exactly the cap returns (possible truncation).
    const result = await runQuery(
      this.supabase.rpc("get_pending_ai_output_metadata", {
        max_rows: PENDING_METADATA_LIMIT,
      }),
    );
    if (result.data && result.data.length === PENDING_METADATA_LIMIT) {
      console.warn(
        `get_pending_ai_output_metadata returned exactly ${PENDING_METADATA_LIMIT} rows — more pending output may exist`,
      );
    }
    return result;
  }

  findContentByIds(
    ids: string[],
  ): Promise<RepoResult<{ id: string; content: string }[]>> {
    return runQuery(
      this.supabase
        .from("ai_output")
        .select("id, content")
        .in("id", ids)
        .eq("picked_up", false)
        .eq("rejected", false),
    );
  }

  async markPickedUp(ids: string[]): Promise<RepoResult<number>> {
    // Claim-style: only stamp rows not already picked up, so an at-least-once
    // client retry is a no-op and never advances `picked_up_at` (which would
    // re-surface an already-reported delivery in `get_recent_activity`).
    // `.select("id")` reports the rows ACTUALLY updated so callers can count
    // real outcomes, never the request's array length (CORE-5).
    const result = await runQuery(
      this.supabase
        .from("ai_output")
        .update({ picked_up: true, picked_up_at: new Date().toISOString() })
        .in("id", ids)
        .eq("picked_up", false)
        .select("id"),
    );
    if (result.error) return { data: null, error: result.error };
    return { data: result.data?.length ?? 0, error: null };
  }

  async reject(ids: string[]): Promise<RepoResult<number>> {
    // Claim-style: only stamp rows not already rejected, so a retried rejection
    // does not re-stamp `rejected_at`. Counts actual updates (CORE-5).
    const result = await runQuery(
      this.supabase
        .from("ai_output")
        .update({ rejected: true, rejected_at: new Date().toISOString() })
        .in("id", ids)
        .eq("rejected", false)
        .select("id"),
    );
    if (result.error) return { data: null, error: result.error };
    return { data: result.data?.length ?? 0, error: null };
  }
}
