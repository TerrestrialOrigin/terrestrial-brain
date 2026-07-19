/**
 * SupabaseThoughtRepository — the sole implementation of `ThoughtRepository`
 * (fix-plan Step 16). Every `thoughts` table name, column list, filter, and
 * RPC call formerly inline in `tools/thoughts.ts` / `helpers.ts` lives here.
 * Each method delegates its await-then-wrap to the shared `runQuery` /
 * `runWrite` helpers (REPO-3).
 */

import type {
  AppSupabaseClient,
  InsertRow,
  UpdateRow,
} from "../supabase-client.ts";
import { z } from "zod";
import {
  type RepoResult,
  runQuery,
  runWrite,
  toRepoError,
} from "./repo-result.ts";
import type {
  NewThought,
  ReviewQueueRow,
  ThoughtActiveRow,
  ThoughtByReferenceRow,
  ThoughtDetailRow,
  ThoughtForUpdateRow,
  ThoughtListFilters,
  ThoughtListRow,
  ThoughtMatchParams,
  ThoughtMatchRow,
  ThoughtRepository,
  ThoughtStatsResult,
  ThoughtUpdate,
} from "./thought-repository.ts";

// The `thought_stats` RPC returns JSONB — untrusted data crossing back into the
// function — so parse it once into a known-good shape instead of casting
// (owner's "parse, don't cast" rule).
const statCountSchema = z.object({ key: z.string(), count: z.number() });
const thoughtStatsSchema = z.object({
  total: z.number(),
  oldest: z.string().nullable(),
  newest: z.string().nullable(),
  types: statCountSchema.array(),
  topics: statCountSchema.array(),
  people: statCountSchema.array(),
});

export class SupabaseThoughtRepository implements ThoughtRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  matchByEmbedding(
    params: ThoughtMatchParams,
  ): Promise<RepoResult<ThoughtMatchRow[]>> {
    return runQuery(
      this.supabase.rpc(
        "search_thoughts_by_embedding",
        {
          // supabase's typegen maps the pgvector column to `string`, but the RPC
          // accepts the JSON number[] at runtime (covered by the vector-search
          // integration tests). This is a documented typegen limitation for
          // pgvector, not an untyped external value.
          query_embedding: params.embedding as unknown as string,
          match_threshold: params.threshold,
          match_count: params.count,
          filter: {},
          filter_author: params.author ?? undefined,
          filter_reliability: params.reliability ?? undefined,
        },
      ),
    );
  }

  list(
    filters: ThoughtListFilters,
  ): Promise<RepoResult<ThoughtListRow[]>> {
    let query = this.supabase
      .from("thoughts")
      .select(
        "id, content, metadata, created_at, updated_at, reliability, author",
      )
      .order("created_at", { ascending: false })
      .limit(filters.limit);

    if (!filters.includeArchived) query = query.is("archived_at", null);
    if (filters.type) {
      query = query.contains("metadata", { type: filters.type });
    }
    if (filters.topic) {
      query = query.contains("metadata", { topics: [filters.topic] });
    }
    if (filters.person) {
      query = query.contains("metadata", { people: [filters.person] });
    }
    if (filters.projectId) {
      query = query.contains("metadata", {
        references: { projects: [filters.projectId] },
      });
    }
    if (filters.author) query = query.eq("author", filters.author);
    if (filters.reliability) {
      query = query.eq("reliability", filters.reliability);
    }
    if (filters.days) {
      const since = new Date();
      since.setDate(since.getDate() - filters.days);
      query = query.gte("created_at", since.toISOString());
    }

    return runQuery(query);
  }

  async stats(projectId?: string): Promise<RepoResult<ThoughtStatsResult>> {
    const result = await runQuery(
      this.supabase.rpc("thought_stats", {
        p_project_id: projectId ?? undefined,
      }),
    );
    if (result.error) {
      return { data: null, error: result.error };
    }
    const parsed = thoughtStatsSchema.safeParse(result.data);
    if (!parsed.success) {
      return {
        data: null,
        error: { message: `Malformed thought_stats result: ${parsed.error}` },
      };
    }
    return { data: parsed.data, error: null };
  }

  findById(id: string): Promise<RepoResult<ThoughtDetailRow>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select("id, content, metadata, reference_id, created_at, updated_at")
        .eq("id", id)
        .single(),
    );
  }

  findForUpdate(id: string): Promise<RepoResult<ThoughtForUpdateRow>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select("id, content, reliability, author, metadata, updated_at")
        .eq("id", id)
        .single(),
    );
  }

  findActiveById(id: string): Promise<RepoResult<ThoughtActiveRow>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select("id, content")
        .eq("id", id)
        .is("archived_at", null)
        .single(),
    );
  }

  findByReference(
    referenceId: string,
  ): Promise<RepoResult<ThoughtByReferenceRow[]>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select("id, content, created_at")
        .eq("reference_id", referenceId)
        .is("archived_at", null)
        .order("created_at", { ascending: true }),
    );
  }

  findByContentHash(
    hash: string,
  ): Promise<RepoResult<{ id: string }[]>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select("id")
        .eq("content_hash", hash)
        .is("archived_at", null)
        .is("superseded_by", null),
    );
  }

  findStale(
    olderThanIso: string,
    staleBeforeIso: string,
    limit: number,
  ): Promise<RepoResult<ReviewQueueRow[]>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select("id, content, created_at, usefulness_score, last_retrieved_at")
        .is("archived_at", null)
        .is("superseded_by", null)
        .lt("created_at", olderThanIso)
        .or(`last_retrieved_at.is.null,last_retrieved_at.lt.${staleBeforeIso}`)
        .order("created_at", { ascending: true })
        .limit(limit),
    );
  }

  findArchivalCandidates(
    olderThanIso: string,
    limit: number,
  ): Promise<RepoResult<ReviewQueueRow[]>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select("id, content, created_at, usefulness_score, last_retrieved_at")
        .is("archived_at", null)
        .is("superseded_by", null)
        .is("last_retrieved_at", null)
        .is("note_snapshot_id", null)
        .eq("usefulness_score", 0)
        .lt("created_at", olderThanIso)
        .order("created_at", { ascending: true })
        .limit(limit),
    );
  }

  setSupersededBy(
    id: string,
    supersededBy: string | null,
  ): Promise<RepoResult<void>> {
    return runWrite(
      this.supabase
        .from("thoughts")
        .update({ superseded_by: supersededBy })
        .eq("id", id),
    );
  }

  async touchRetrieved(ids: string[]): Promise<RepoResult<void>> {
    if (ids.length === 0) return { data: null, error: null };
    return await runWrite(
      this.supabase
        .from("thoughts")
        .update({ last_retrieved_at: new Date().toISOString() })
        .in("id", ids),
    );
  }

  insert(thought: NewThought): Promise<RepoResult<void>> {
    // supabase's typegen types the pgvector `embedding` column as `string` and
    // the jsonb `metadata` as `Json`; the runtime accepts the number[] embedding
    // and the plain metadata object we build. This narrow, documented assertion
    // bridges those two typegen limitations for a trusted internal payload.
    const insertRow = thought as unknown as InsertRow<"thoughts">;
    return runWrite(this.supabase.from("thoughts").insert(insertRow));
  }

  async update(
    id: string,
    payload: ThoughtUpdate,
    options?: { expectedUpdatedAt?: string },
  ): Promise<RepoResult<{ id: string } | null>> {
    // Same documented typegen bridge as `insert`: `embedding` (pgvector →
    // `string`) and `metadata` (jsonb → `Json`) hold a trusted internal
    // number[] / plain object.
    const updateRow = payload as unknown as UpdateRow<"thoughts">;
    // Optimistic concurrency (TOOL-6): with a guard, a stale snapshot filters
    // to zero rows; the trigger-maintained updated_at is the etag. `data: null`
    // with a null error is the caller's "concurrent edit — retry" signal.
    let query = this.supabase
      .from("thoughts")
      .update(updateRow)
      .eq("id", id);
    if (options?.expectedUpdatedAt !== undefined) {
      query = query.eq("updated_at", options.expectedUpdatedAt);
    }
    const matched = await runQuery(query.select("id"));
    if (matched.error) return { data: null, error: matched.error };
    return { data: matched.data?.[0] ?? null, error: null };
  }

  archive(id: string): Promise<RepoResult<void>> {
    // Claim-style: skip already-archived rows so a retried archive preserves
    // the original `archived_at`.
    return runWrite(
      this.supabase
        .from("thoughts")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .is("archived_at", null),
    );
  }

  archiveByDocumentReference(
    documentId: string,
  ): Promise<RepoResult<void>> {
    return runWrite(
      this.supabase
        .from("thoughts")
        .update({ archived_at: new Date().toISOString() })
        .contains("metadata", { references: { documents: [documentId] } }),
    );
  }

  incrementUsefulness(ids: string[]): Promise<RepoResult<number>> {
    return runQuery(
      this.supabase.rpc("increment_usefulness", { thought_ids: ids }),
    );
  }

  incrementUsefulnessWeighted(
    ids: string[],
    weight: number,
  ): Promise<RepoResult<number>> {
    return runQuery(
      this.supabase.rpc(
        "increment_usefulness_weighted",
        { thought_ids: ids, weight },
      ),
    );
  }

  async deleteByNoteSnapshot(
    snapshotId: string,
  ): Promise<RepoResult<number>> {
    const { data, error } = await this.supabase
      .from("thoughts")
      .delete()
      .eq("note_snapshot_id", snapshotId)
      .select("id");
    return { data: data?.length ?? 0, error: toRepoError(error) };
  }
}
