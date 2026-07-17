/**
 * TaskRepository — the single seam over the `tasks` table (fix-plan Step 16,
 * finding X2). Only operations with a current caller appear here. Injected
 * through `register(...)` and placed on `ExtractionContext` for `TaskExtractor`.
 */

import type { RepoResult } from "./repo-result.ts";
import type { Row } from "../supabase-client.ts";

/** Row shape returned to `list_tasks`. */
export type TaskListRow = Pick<
  Row<"tasks">,
  | "id"
  | "content"
  | "status"
  | "due_by"
  | "project_id"
  | "assigned_to"
  | "archived_at"
  | "created_at"
>;

/** Fuller row shape returned to `get_tasks` (includes parent link). */
export type TaskDetailRow = Pick<
  Row<"tasks">,
  | "id"
  | "content"
  | "status"
  | "due_by"
  | "project_id"
  | "parent_id"
  | "assigned_to"
  | "archived_at"
  | "created_at"
>;

/** The identity of a freshly-inserted task (id for linking, content for logs). */
export type CreatedTask = Pick<Row<"tasks">, "id" | "content">;

/** Values for inserting a task. Content + status are required; rest optional. */
export interface NewTaskValues {
  content: string;
  content_hash?: string;
  status: string;
  project_id?: string | null;
  parent_id?: string | null;
  due_by?: string | null;
  assigned_to?: string | null;
  reference_id?: string | null;
  metadata?: Record<string, unknown>;
  archived_at?: string | null;
}

export interface TaskListFilters {
  limit: number;
  includeArchived: boolean;
  overdueOnly: boolean;
  projectId?: string;
  status?: string;
}

/** Filters for the whole-brain grouped-by-project view. */
export interface IncompleteTasksFilters {
  /** Hard cap on rows fetched. The impl reads `limit + 1` to detect truncation. */
  limit: number;
  /** When false, `deferred` tasks are excluded alongside `done`. */
  includeDeferred: boolean;
}

/** A task row read for the extractor pipeline's reconciliation context seed. */
export interface TaskReferenceRow {
  id: string;
  content: string;
  reference_id: string | null;
}

export interface TaskRepository {
  /** Insert a task; returns the new row's id and content. */
  insert(values: NewTaskValues): Promise<RepoResult<CreatedTask>>;

  /** List tasks with optional project/status/overdue/archived filters. */
  list(filters: TaskListFilters): Promise<RepoResult<TaskListRow[]>>;

  /**
   * Every incomplete (status != 'done'), unarchived task across all projects,
   * ordered for grouped display (overdue/soonest due first, undated last, then
   * created ascending). Fetches at most `limit + 1` rows so the caller can
   * detect truncation. Backs `list_open_tasks_by_project`.
   */
  listIncompleteUnarchived(
    filters: IncompleteTasksFilters,
  ): Promise<RepoResult<TaskListRow[]>>;

  /** Fetch tasks by id (archived included). */
  findByIds(ids: string[]): Promise<RepoResult<TaskDetailRow[]>>;

  /**
   * Apply a partial update to a task. Returns the updated row's id, or `null`
   * data when no row matched `id` (Step 24 affected-row verification).
   */
  update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<{ id: string }>>;

  /** Archive a task (sets `archived_at`; leaves status untouched). */
  archive(id: string): Promise<RepoResult<void>>;

  /**
   * Archive a task only if it is not already archived, also marking it done —
   * the reconciliation "removed from note" path (TaskExtractor Phase 5).
   */
  archiveIfActive(id: string): Promise<RepoResult<void>>;

  /**
   * Count open/in-progress tasks for a project (used by `get_project`). Does not
   * filter on `archived_at` — preserves the exact prior query.
   */
  countOpenByProject(projectId: string): Promise<RepoResult<number>>;

  /**
   * Count active open/in-progress tasks assigned to a person (used by
   * `get_person`). Filters out archived tasks — preserves the exact prior query.
   */
  countOpenByAssignee(personId: string): Promise<RepoResult<number>>;

  /** Ids of active open/in-progress tasks for any of the given projects. */
  findOpenIdsByProjects(
    projectIds: string[],
  ): Promise<RepoResult<{ id: string }[]>>;

  /** Archive every task in `ids` (sets `archived_at`). */
  archiveMany(ids: string[]): Promise<RepoResult<void>>;

  /** Hard-delete tasks by id — the `create_tasks_with_output` rollback path. */
  deleteByIds(ids: string[]): Promise<RepoResult<void>>;

  /** Tasks for a note reference (extractor reconciliation context seed). */
  findByReference(
    referenceId: string,
  ): Promise<RepoResult<TaskReferenceRow[]>>;
}
