/**
 * SupabaseTaskRepository — the sole implementation of `TaskRepository`
 * (fix-plan Step 16). Every `tasks` table query formerly inline in
 * `tools/tasks.ts` / `extractors/task-extractor.ts` lives here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  CreatedTask,
  NewTaskValues,
  TaskDetailRow,
  TaskListFilters,
  TaskListRow,
  TaskReferenceRow,
  TaskRepository,
} from "./task-repository.ts";

export class SupabaseTaskRepository implements TaskRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async insert(values: NewTaskValues): Promise<RepoResult<CreatedTask>> {
    const { data, error } = await this.supabase
      .from("tasks")
      .insert(values)
      .select("id, content")
      .single();
    return { data, error: toRepoError(error) };
  }

  async list(filters: TaskListFilters): Promise<RepoResult<TaskListRow[]>> {
    let query = this.supabase
      .from("tasks")
      .select(
        "id, content, status, due_by, project_id, assigned_to, archived_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(filters.limit);

    if (!filters.includeArchived) query = query.is("archived_at", null);
    if (filters.projectId) query = query.eq("project_id", filters.projectId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.overdueOnly) {
      query = query
        .lt("due_by", new Date().toISOString())
        .neq("status", "done");
    }

    const { data, error } = await query;
    return { data, error: toRepoError(error) };
  }

  async findByIds(ids: string[]): Promise<RepoResult<TaskDetailRow[]>> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select(
        "id, content, status, due_by, project_id, parent_id, assigned_to, archived_at, created_at",
      )
      .in("id", ids);
    return { data, error: toRepoError(error) };
  }

  async update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("tasks")
      .update(updates)
      .eq("id", id);
    return { data: null, error: toRepoError(error) };
  }

  async archive(id: string): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("tasks")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    return { data: null, error: toRepoError(error) };
  }

  async archiveIfActive(id: string): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("tasks")
      .update({ archived_at: new Date().toISOString(), status: "done" })
      .eq("id", id)
      .is("archived_at", null);
    return { data: null, error: toRepoError(error) };
  }

  async countOpenByProject(projectId: string): Promise<RepoResult<number>> {
    const { count, error } = await this.supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("status", ["open", "in_progress"]);
    return { data: count ?? 0, error: toRepoError(error) };
  }

  async countOpenByAssignee(personId: string): Promise<RepoResult<number>> {
    const { count, error } = await this.supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", personId)
      .in("status", ["open", "in_progress"])
      .is("archived_at", null);
    return { data: count ?? 0, error: toRepoError(error) };
  }

  async findOpenIdsByProjects(
    projectIds: string[],
  ): Promise<RepoResult<{ id: string }[]>> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("id")
      .in("project_id", projectIds)
      .is("archived_at", null)
      .in("status", ["open", "in_progress"]);
    return { data, error: toRepoError(error) };
  }

  async archiveMany(ids: string[]): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("tasks")
      .update({ archived_at: new Date().toISOString() })
      .in("id", ids);
    return { data: null, error: toRepoError(error) };
  }

  async deleteByIds(ids: string[]): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("tasks")
      .delete()
      .in("id", ids);
    return { data: null, error: toRepoError(error) };
  }

  async findByReference(
    referenceId: string,
  ): Promise<RepoResult<TaskReferenceRow[]>> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("id, content, reference_id")
      .eq("reference_id", referenceId);
    return { data, error: toRepoError(error) };
  }
}
