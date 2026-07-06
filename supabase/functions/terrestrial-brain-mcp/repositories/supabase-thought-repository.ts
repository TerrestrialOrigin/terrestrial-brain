/**
 * SupabaseThoughtRepository — the sole implementation of `ThoughtRepository`
 * (fix-plan Step 16). Every `thoughts` table name, column list, filter, and
 * RPC call formerly inline in `tools/thoughts.ts` / `helpers.ts` lives here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  NewThought,
  ThoughtActiveRow,
  ThoughtByReferenceRow,
  ThoughtDetailRow,
  ThoughtForUpdateRow,
  ThoughtListFilters,
  ThoughtListRow,
  ThoughtMatchParams,
  ThoughtMatchRow,
  ThoughtRepository,
  ThoughtStatsRow,
} from "./thought-repository.ts";

export class SupabaseThoughtRepository implements ThoughtRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async matchByEmbedding(
    params: ThoughtMatchParams,
  ): Promise<RepoResult<ThoughtMatchRow[]>> {
    const { data, error } = await this.supabase.rpc("match_thoughts", {
      query_embedding: params.embedding,
      match_threshold: params.threshold,
      match_count: params.count,
      filter: {},
      filter_author: params.author ?? null,
      filter_reliability: params.reliability ?? null,
    });
    return { data, error: toRepoError(error) };
  }

  async list(
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

    const { data, error } = await query;
    return { data, error: toRepoError(error) };
  }

  async countActive(projectId?: string): Promise<RepoResult<number>> {
    let query = this.supabase
      .from("thoughts")
      .select("*", { count: "exact", head: true })
      .is("archived_at", null);
    if (projectId) {
      query = query.contains("metadata", {
        references: { projects: [projectId] },
      });
    }
    const { count, error } = await query;
    return { data: count ?? null, error: toRepoError(error) };
  }

  async listForStats(
    projectId?: string,
  ): Promise<RepoResult<ThoughtStatsRow[]>> {
    let query = this.supabase
      .from("thoughts")
      .select("metadata, created_at")
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    if (projectId) {
      query = query.contains("metadata", {
        references: { projects: [projectId] },
      });
    }
    const { data, error } = await query;
    return { data, error: toRepoError(error) };
  }

  async findById(id: string): Promise<RepoResult<ThoughtDetailRow>> {
    const { data, error } = await this.supabase
      .from("thoughts")
      .select("id, content, metadata, reference_id, created_at, updated_at")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async findForUpdate(id: string): Promise<RepoResult<ThoughtForUpdateRow>> {
    const { data, error } = await this.supabase
      .from("thoughts")
      .select("id, content, reliability, author, metadata")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async findActiveById(id: string): Promise<RepoResult<ThoughtActiveRow>> {
    const { data, error } = await this.supabase
      .from("thoughts")
      .select("id, content")
      .eq("id", id)
      .is("archived_at", null)
      .single();
    return { data, error: toRepoError(error) };
  }

  async findByReference(
    referenceId: string,
  ): Promise<RepoResult<ThoughtByReferenceRow[]>> {
    const { data, error } = await this.supabase
      .from("thoughts")
      .select("id, content, created_at")
      .eq("reference_id", referenceId)
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    return { data, error: toRepoError(error) };
  }

  async insert(thought: NewThought): Promise<RepoResult<void>> {
    const { error } = await this.supabase.from("thoughts").insert(thought);
    return { data: null, error: toRepoError(error) };
  }

  async update(
    id: string,
    payload: Record<string, unknown>,
  ): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("thoughts")
      .update(payload)
      .eq("id", id);
    return { data: null, error: toRepoError(error) };
  }

  async archive(id: string): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("thoughts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    return { data: null, error: toRepoError(error) };
  }

  async archiveByDocumentReference(
    documentId: string,
  ): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("thoughts")
      .update({ archived_at: new Date().toISOString() })
      .contains("metadata", { references: { documents: [documentId] } });
    return { data: null, error: toRepoError(error) };
  }

  async incrementUsefulness(ids: string[]): Promise<RepoResult<number>> {
    const { data, error } = await this.supabase.rpc("increment_usefulness", {
      thought_ids: ids,
    });
    return { data, error: toRepoError(error) };
  }
}
