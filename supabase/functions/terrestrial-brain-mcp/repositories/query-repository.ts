/**
 * QueryRepository — a read-only seam owning every database read performed by
 * `tools/queries.ts` (`get_project_summary`, `get_recent_activity`,
 * `get_note_snapshot`) across the projects/tasks/thoughts/note_snapshots/people/
 * ai_output tables (fix-plan Step 17, finding X2). Each method performs a single
 * query so it stays fake-testable one query at a time; the handlers do the
 * composition + formatting. Name resolution delegates to the shared
 * `resolveNames` helper — no reimplemented `IN` lookup.
 */

import type { RepoResult } from "./repo-result.ts";

// ── get_project_summary row shapes ──────────────────────────────────────────

export interface SummaryProjectRow {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  parent_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SummaryChildRow {
  id: string;
  name: string;
  type: string | null;
}

export interface SummaryTaskRow {
  id: string;
  content: string;
  status: string;
  due_by: string | null;
  assigned_to: string | null;
  created_at: string;
}

export interface SummaryThoughtRow {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  note_snapshot_id: string | null;
  created_at: string;
}

export interface SummarySnapshotRow {
  id: string;
  title: string | null;
  reference_id: string;
}

// ── get_recent_activity row shapes ──────────────────────────────────────────

export interface RecentThoughtRow {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RecentTaskCreatedRow {
  content: string;
  status: string;
  project_id: string | null;
  created_at: string;
}

export interface RecentTaskCompletedRow {
  content: string;
  project_id: string | null;
  updated_at: string;
}

/** A `name` + `type` row carrying its `created_at` (the "created" queries). */
export interface CreatedNamedRow {
  name: string;
  type: string | null;
  created_at: string;
}

/** A `name` + `type` row carrying its `updated_at` (the "updated" queries). */
export interface UpdatedNamedRow {
  name: string;
  type: string | null;
  updated_at: string;
}

export interface DeliveredAiOutputRow {
  title: string;
  file_path: string;
  picked_up_at: string;
}

// ── get_note_snapshot row shape ─────────────────────────────────────────────

export interface NoteSnapshotDetailRow {
  id: string;
  reference_id: string;
  title: string | null;
  content: string;
  source: string | null;
  captured_at: string;
}

export interface QueryRepository {
  // get_project_summary
  getProjectById(id: string): Promise<RepoResult<SummaryProjectRow>>;
  getProjectName(id: string): Promise<RepoResult<{ name: string }>>;
  listChildProjects(parentId: string): Promise<RepoResult<SummaryChildRow[]>>;
  listOpenTasksForProject(
    projectId: string,
  ): Promise<RepoResult<SummaryTaskRow[]>>;
  listThoughtsForProjectNewFormat(
    projectId: string,
  ): Promise<RepoResult<SummaryThoughtRow[]>>;
  listThoughtsForProjectOldFormat(
    projectId: string,
  ): Promise<RepoResult<SummaryThoughtRow[]>>;
  getNoteSnapshotsByIds(
    ids: string[],
  ): Promise<RepoResult<SummarySnapshotRow[]>>;
  /** Assignee id → name, via the shared `resolveNames` helper. */
  personNamesByIds(ids: string[]): Promise<Map<string, string>>;

  // get_recent_activity
  listRecentThoughts(
    sinceIso: string,
  ): Promise<RepoResult<RecentThoughtRow[]>>;
  listTasksCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<RecentTaskCreatedRow[]>>;
  listTasksCompletedSince(
    sinceIso: string,
  ): Promise<RepoResult<RecentTaskCompletedRow[]>>;
  listProjectsCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<CreatedNamedRow[]>>;
  listProjectsUpdatedSince(
    sinceIso: string,
  ): Promise<RepoResult<UpdatedNamedRow[]>>;
  listPeopleCreatedSince(
    sinceIso: string,
  ): Promise<RepoResult<CreatedNamedRow[]>>;
  listPeopleUpdatedSince(
    sinceIso: string,
  ): Promise<RepoResult<UpdatedNamedRow[]>>;
  listDeliveredAiOutputsSince(
    sinceIso: string,
  ): Promise<RepoResult<DeliveredAiOutputRow[]>>;
  /** Task project id → name, via the shared `resolveNames` helper. */
  projectNamesByIds(ids: string[]): Promise<Map<string, string>>;

  // get_note_snapshot
  getNoteSnapshotById(
    id: string,
  ): Promise<RepoResult<NoteSnapshotDetailRow>>;
  getNoteSnapshotByReference(
    referenceId: string,
  ): Promise<RepoResult<NoteSnapshotDetailRow>>;
}
