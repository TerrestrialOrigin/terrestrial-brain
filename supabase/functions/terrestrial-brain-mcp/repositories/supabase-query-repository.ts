/**
 * SupabaseQueryRepository — the sole implementation of `QueryRepository`
 * (fix-plan Step 17). Every read formerly inline in `tools/queries.ts` lives
 * here. `repositories/` is where `supabase.from(...)` is allowed to live — the
 * grep acceptance gate targets `tools/` and `extractors/` only.
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import { resolveNames } from "./name-resolution.ts";
import type {
  CreatedNamedRow,
  DeliveredAiOutputRow,
  NoteSnapshotDetailRow,
  QueryRepository,
  RecentTaskCompletedRow,
  RecentTaskCreatedRow,
  RecentThoughtRow,
  SummaryChildRow,
  SummaryProjectRow,
  SummarySnapshotRow,
  SummaryTaskRow,
  SummaryThoughtRow,
  UpdatedNamedRow,
} from "./query-repository.ts";

const PROJECT_THOUGHT_COLUMNS =
  "id, content, metadata, note_snapshot_id, created_at";

export class SupabaseQueryRepository implements QueryRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  // ── get_project_summary ───────────────────────────────────────────────────

  async getProjectById(id: string): Promise<RepoResult<SummaryProjectRow>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async getProjectName(id: string): Promise<RepoResult<{ name: string }>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("name")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async listChildProjects(
    parentId: string,
  ): Promise<RepoResult<SummaryChildRow[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("id, name, type")
      .eq("parent_id", parentId)
      .is("archived_at", null)
      .order("name");
    return { data, error: toRepoError(error) };
  }

  async listOpenTasksForProject(
    projectId: string,
  ): Promise<RepoResult<SummaryTaskRow[]>> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("id, content, status, due_by, assigned_to, created_at")
      .eq("project_id", projectId)
      .is("archived_at", null)
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false });
    return { data, error: toRepoError(error) };
  }

  async listThoughtsForProjectNewFormat(
    projectId: string,
  ): Promise<RepoResult<SummaryThoughtRow[]>> {
    const { data, error } = await this.supabase
      .from("thoughts")
      .select(PROJECT_THOUGHT_COLUMNS)
      .contains("metadata", { references: { projects: [projectId] } })
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(25);
    return { data, error: toRepoError(error) };
  }

  async listThoughtsForProjectOldFormat(
    projectId: string,
  ): Promise<RepoResult<SummaryThoughtRow[]>> {
    const { data, error } = await this.supabase
      .from("thoughts")
      .select(PROJECT_THOUGHT_COLUMNS)
      .contains("metadata", { references: { project_id: projectId } })
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(25);
    return { data, error: toRepoError(error) };
  }

  async getNoteSnapshotsByIds(
    ids: string[],
  ): Promise<RepoResult<SummarySnapshotRow[]>> {
    const { data, error } = await this.supabase
      .from("note_snapshots")
      .select("id, title, reference_id")
      .in("id", ids);
    return { data, error: toRepoError(error) };
  }

  personNamesByIds(ids: string[]): Promise<Map<string, string>> {
    return resolveNames(this.supabase, "people", ids);
  }

  // ── get_recent_activity ───────────────────────────────────────────────────

  async listRecentThoughts(
    sinceIso: string,
  ): Promise<RepoResult<RecentThoughtRow[]>> {
    const { data, error } = await this.supabase
      .from("thoughts")
      .select("id, content, metadata, created_at")
      .is("archived_at", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(20);
    return { data, error: toRepoError(error) };
  }

  async listTasksCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<RecentTaskCreatedRow[]>> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("content, status, project_id, created_at")
      .is("archived_at", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false });
    return { data, error: toRepoError(error) };
  }

  async listTasksCompletedSince(
    sinceIso: string,
  ): Promise<RepoResult<RecentTaskCompletedRow[]>> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("content, project_id, updated_at")
      .eq("status", "done")
      .is("archived_at", null)
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false });
    return { data, error: toRepoError(error) };
  }

  async listProjectsCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<CreatedNamedRow[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("name, type, created_at")
      .is("archived_at", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false });
    return { data, error: toRepoError(error) };
  }

  async listProjectsUpdatedSince(
    sinceIso: string,
  ): Promise<RepoResult<UpdatedNamedRow[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("name, type, updated_at")
      .is("archived_at", null)
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false });
    return { data, error: toRepoError(error) };
  }

  async listPeopleCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<CreatedNamedRow[]>> {
    const { data, error } = await this.supabase
      .from("people")
      .select("name, type, created_at")
      .is("archived_at", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false });
    return { data, error: toRepoError(error) };
  }

  async listPeopleUpdatedSince(
    sinceIso: string,
  ): Promise<RepoResult<UpdatedNamedRow[]>> {
    const { data, error } = await this.supabase
      .from("people")
      .select("name, type, updated_at")
      .is("archived_at", null)
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false });
    return { data, error: toRepoError(error) };
  }

  async listDeliveredAiOutputsSince(
    sinceIso: string,
  ): Promise<RepoResult<DeliveredAiOutputRow[]>> {
    const { data, error } = await this.supabase
      .from("ai_output")
      .select("title, file_path, picked_up_at")
      .eq("picked_up", true)
      .gte("picked_up_at", sinceIso)
      .order("picked_up_at", { ascending: false });
    return { data, error: toRepoError(error) };
  }

  projectNamesByIds(ids: string[]): Promise<Map<string, string>> {
    return resolveNames(this.supabase, "projects", ids);
  }

  // ── get_note_snapshot ─────────────────────────────────────────────────────

  async getNoteSnapshotById(
    id: string,
  ): Promise<RepoResult<NoteSnapshotDetailRow>> {
    const { data, error } = await this.supabase
      .from("note_snapshots")
      .select("id, reference_id, title, content, source, captured_at")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async getNoteSnapshotByReference(
    referenceId: string,
  ): Promise<RepoResult<NoteSnapshotDetailRow>> {
    const { data, error } = await this.supabase
      .from("note_snapshots")
      .select("id, reference_id, title, content, source, captured_at")
      .eq("reference_id", referenceId)
      .single();
    return { data, error: toRepoError(error) };
  }
}
