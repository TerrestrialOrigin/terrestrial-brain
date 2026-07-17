/**
 * SupabaseProjectRepository — the sole implementation of `ProjectRepository`
 * (fix-plan Step 17). Every `projects` table query formerly inline in
 * `tools/projects.ts` / `extractors/project-extractor.ts` lives here.
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { LIST_ACTIVE_HARD_CAP } from "../constants.ts";
import { escapeLikePattern } from "../escape-like.ts";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  NewProjectValues,
  ProjectChildRow,
  ProjectFullRow,
  ProjectIdentity,
  ProjectListFilters,
  ProjectListRow,
  ProjectRepository,
} from "./project-repository.ts";

export class SupabaseProjectRepository implements ProjectRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  async insert(
    values: NewProjectValues,
  ): Promise<RepoResult<ProjectIdentity>> {
    const { data, error } = await this.supabase
      .from("projects")
      .insert(values)
      .select("id, name")
      .single();
    return { data, error: toRepoError(error) };
  }

  async findByName(name: string): Promise<RepoResult<ProjectIdentity | null>> {
    // Active project matching case-insensitively — mirrors the unique index
    // `uq_projects_active_name` on (lower(name)) where archived_at is null, so
    // a 23505-losing racer recovers the winning row. `maybeSingle` maps a clean
    // miss to null data (not an error).
    const { data, error } = await this.supabase
      .from("projects")
      .select("id, name")
      .ilike("name", escapeLikePattern(name))
      .is("archived_at", null)
      .maybeSingle();
    return { data, error: toRepoError(error) };
  }

  async list(
    filters: ProjectListFilters,
  ): Promise<RepoResult<ProjectListRow[]>> {
    let query = this.supabase
      .from("projects")
      .select("id, name, type, parent_id, archived_at, created_at")
      .order("created_at", { ascending: false });

    if (!filters.includeArchived) query = query.is("archived_at", null);
    if (filters.parentId) query = query.eq("parent_id", filters.parentId);
    if (filters.type) query = query.eq("type", filters.type);
    // Fetch one extra so the handler distinguishes "exactly at the cap" from
    // "more exist" and reports truncation (never a silent fetch-all).
    query = query.limit(filters.limit + 1);

    const { data, error } = await query;
    return { data, error: toRepoError(error) };
  }

  async findById(id: string): Promise<RepoResult<ProjectFullRow>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async findName(id: string): Promise<RepoResult<{ name: string }>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("name")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async listChildrenBasic(
    parentId: string,
  ): Promise<RepoResult<ProjectChildRow[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("id, name, type")
      .eq("parent_id", parentId)
      .is("archived_at", null);
    return { data, error: toRepoError(error) };
  }

  async listChildParentIds(
    parentIds: string[],
  ): Promise<RepoResult<{ parent_id: string | null }[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("parent_id")
      .in("parent_id", parentIds)
      .is("archived_at", null);
    return { data, error: toRepoError(error) };
  }

  async listActiveChildIds(
    parentIds: string[],
  ): Promise<RepoResult<{ id: string }[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("id")
      .in("parent_id", parentIds)
      .is("archived_at", null);
    return { data, error: toRepoError(error) };
  }

  async update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<{ id: string }>> {
    const { data, error } = await this.supabase
      .from("projects")
      .update(updates)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    return { data, error: toRepoError(error) };
  }

  async archiveManyActive(ids: string[]): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("projects")
      .update({ archived_at: new Date().toISOString() })
      .in("id", ids)
      .is("archived_at", null);
    return { data: null, error: toRepoError(error) };
  }

  async listActive(): Promise<RepoResult<ProjectIdentity[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("id, name")
      .is("archived_at", null)
      // Whole-set seed for the extractor, but explicitly bounded — a silent
      // full scan is not allowed. Truncation past the cap is logged.
      .limit(LIST_ACTIVE_HARD_CAP);
    if (data && data.length === LIST_ACTIVE_HARD_CAP) {
      console.warn(
        `listActive(projects) hit the ${LIST_ACTIVE_HARD_CAP}-row cap — extractor seed may be truncated`,
      );
    }
    return { data, error: toRepoError(error) };
  }
}
