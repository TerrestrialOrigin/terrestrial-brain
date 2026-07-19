/**
 * SupabaseQueryRepository — the sole implementation of `QueryRepository`
 * (fix-plan Step 17). Every read formerly inline in `tools/queries.ts` lives
 * here. `repositories/` is where `supabase.from(...)` is allowed to live — the
 * grep acceptance gate targets `tools/` and `extractors/` only. Each method
 * delegates its await-then-wrap to the shared `runQuery` helper (REPO-3).
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { RECENT_ACTIVITY_SECTION_LIMIT } from "../constants.ts";
import { type RepoResult, runQuery } from "./repo-result.ts";
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

  getProjectById(id: string): Promise<RepoResult<SummaryProjectRow>> {
    return runQuery(
      this.supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single(),
    );
  }

  getProjectName(id: string): Promise<RepoResult<{ name: string }>> {
    return runQuery(
      this.supabase
        .from("projects")
        .select("name")
        .eq("id", id)
        .single(),
    );
  }

  listChildProjects(
    parentId: string,
  ): Promise<RepoResult<SummaryChildRow[]>> {
    return runQuery(
      this.supabase
        .from("projects")
        .select("id, name, type")
        .eq("parent_id", parentId)
        .is("archived_at", null)
        .order("name"),
    );
  }

  listOpenTasksForProject(
    projectId: string,
  ): Promise<RepoResult<SummaryTaskRow[]>> {
    return runQuery(
      this.supabase
        .from("tasks")
        .select("id, content, status, due_by, assigned_to, created_at")
        .eq("project_id", projectId)
        .is("archived_at", null)
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  listThoughtsForProjectNewFormat(
    projectId: string,
  ): Promise<RepoResult<SummaryThoughtRow[]>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select(PROJECT_THOUGHT_COLUMNS)
        .contains("metadata", { references: { projects: [projectId] } })
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(25),
    );
  }

  listThoughtsForProjectOldFormat(
    projectId: string,
  ): Promise<RepoResult<SummaryThoughtRow[]>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select(PROJECT_THOUGHT_COLUMNS)
        .contains("metadata", { references: { project_id: projectId } })
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(25),
    );
  }

  getNoteSnapshotsByIds(
    ids: string[],
  ): Promise<RepoResult<SummarySnapshotRow[]>> {
    return runQuery(
      this.supabase
        .from("note_snapshots")
        .select("id, title, reference_id")
        .in("id", ids),
    );
  }

  personNamesByIds(ids: string[]): Promise<Map<string, string>> {
    return resolveNames(this.supabase, "people", ids);
  }

  // ── get_recent_activity ───────────────────────────────────────────────────

  listRecentThoughts(
    sinceIso: string,
  ): Promise<RepoResult<RecentThoughtRow[]>> {
    return runQuery(
      this.supabase
        .from("thoughts")
        .select("id, content, metadata, created_at")
        .is("archived_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  listTasksCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<RecentTaskCreatedRow[]>> {
    return runQuery(
      this.supabase
        .from("tasks")
        .select("content, status, project_id, created_at")
        .is("archived_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  listTasksCompletedSince(
    sinceIso: string,
  ): Promise<RepoResult<RecentTaskCompletedRow[]>> {
    return runQuery(
      this.supabase
        .from("tasks")
        .select("content, project_id, updated_at")
        .eq("status", "done")
        .is("archived_at", null)
        .gte("updated_at", sinceIso)
        .order("updated_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  listProjectsCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<CreatedNamedRow[]>> {
    return runQuery(
      this.supabase
        .from("projects")
        .select("name, type, created_at")
        .is("archived_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  listProjectsUpdatedSince(
    sinceIso: string,
  ): Promise<RepoResult<UpdatedNamedRow[]>> {
    return runQuery(
      this.supabase
        .from("projects")
        .select("name, type, updated_at")
        .is("archived_at", null)
        .gte("updated_at", sinceIso)
        .order("updated_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  listPeopleCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<CreatedNamedRow[]>> {
    return runQuery(
      this.supabase
        .from("people")
        .select("name, type, created_at")
        .is("archived_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  listPeopleUpdatedSince(
    sinceIso: string,
  ): Promise<RepoResult<UpdatedNamedRow[]>> {
    return runQuery(
      this.supabase
        .from("people")
        .select("name, type, updated_at")
        .is("archived_at", null)
        .gte("updated_at", sinceIso)
        .order("updated_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  listDeliveredAiOutputsSince(
    sinceIso: string,
  ): Promise<RepoResult<DeliveredAiOutputRow[]>> {
    return runQuery(
      this.supabase
        .from("ai_output")
        .select("title, file_path, picked_up_at")
        .eq("picked_up", true)
        .gte("picked_up_at", sinceIso)
        .order("picked_up_at", { ascending: false })
        .limit(RECENT_ACTIVITY_SECTION_LIMIT + 1),
    );
  }

  projectNamesByIds(ids: string[]): Promise<Map<string, string>> {
    return resolveNames(this.supabase, "projects", ids);
  }

  // ── get_note_snapshot ─────────────────────────────────────────────────────

  getNoteSnapshotById(
    id: string,
  ): Promise<RepoResult<NoteSnapshotDetailRow>> {
    return runQuery(
      this.supabase
        .from("note_snapshots")
        .select("id, reference_id, title, content, source, captured_at")
        .eq("id", id)
        .single(),
    );
  }

  getNoteSnapshotByReference(
    referenceId: string,
  ): Promise<RepoResult<NoteSnapshotDetailRow>> {
    return runQuery(
      this.supabase
        .from("note_snapshots")
        .select("id, reference_id, title, content, source, captured_at")
        .eq("reference_id", referenceId)
        .single(),
    );
  }
}
