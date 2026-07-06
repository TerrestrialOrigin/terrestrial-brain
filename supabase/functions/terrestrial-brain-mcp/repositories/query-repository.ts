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
import type { Row } from "../supabase-client.ts";

// ── get_project_summary row shapes ──────────────────────────────────────────
// Row DTOs are projections of the generated schema types (Step 24).

export type SummaryProjectRow = Pick<
  Row<"projects">,
  | "id"
  | "name"
  | "type"
  | "description"
  | "parent_id"
  | "archived_at"
  | "created_at"
  | "updated_at"
>;

export type SummaryChildRow = Pick<Row<"projects">, "id" | "name" | "type">;

export type SummaryTaskRow = Pick<
  Row<"tasks">,
  "id" | "content" | "status" | "due_by" | "assigned_to" | "created_at"
>;

export type SummaryThoughtRow = Pick<
  Row<"thoughts">,
  "id" | "content" | "metadata" | "note_snapshot_id" | "created_at"
>;

export type SummarySnapshotRow = Pick<
  Row<"note_snapshots">,
  "id" | "title" | "reference_id"
>;

// ── get_recent_activity row shapes ──────────────────────────────────────────

export type RecentThoughtRow = Pick<
  Row<"thoughts">,
  "id" | "content" | "metadata" | "created_at"
>;

export type RecentTaskCreatedRow = Pick<
  Row<"tasks">,
  "content" | "status" | "project_id" | "created_at"
>;

export type RecentTaskCompletedRow = Pick<
  Row<"tasks">,
  "content" | "project_id" | "updated_at"
>;

/** A `name` + `type` row carrying its `created_at` (the "created" queries). */
export type CreatedNamedRow = Pick<
  Row<"projects">,
  "name" | "type" | "created_at"
>;

/** A `name` + `type` row carrying its `updated_at` (the "updated" queries). */
export type UpdatedNamedRow = Pick<
  Row<"projects">,
  "name" | "type" | "updated_at"
>;

export type DeliveredAiOutputRow = Pick<
  Row<"ai_output">,
  "title" | "file_path" | "picked_up_at"
>;

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
