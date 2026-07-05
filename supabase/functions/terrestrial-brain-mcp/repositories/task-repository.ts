/**
 * TaskRepository — the single seam over the `tasks` table (fix-plan Step 16,
 * finding X2). Only operations with a current caller appear here. Injected
 * through `register(...)` and placed on `ExtractionContext` for `TaskExtractor`.
 */

import type { RepoResult } from "./repo-result.ts";

/** Row shape returned to `list_tasks`. */
export interface TaskListRow {
  id: string;
  content: string;
  status: string;
  due_by: string | null;
  project_id: string | null;
  assigned_to: string | null;
  archived_at: string | null;
  created_at: string;
}

/** Fuller row shape returned to `get_tasks` (includes parent link). */
export interface TaskDetailRow {
  id: string;
  content: string;
  status: string;
  due_by: string | null;
  project_id: string | null;
  parent_id: string | null;
  assigned_to: string | null;
  archived_at: string | null;
  created_at: string;
}

/** The identity of a freshly-inserted task (id for linking, content for logs). */
export interface CreatedTask {
  id: string;
  content: string;
}

/** Values for inserting a task. Content + status are required; rest optional. */
export interface NewTaskValues {
  content: string;
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

export interface TaskRepository {
  /** Insert a task; returns the new row's id and content. */
  insert(values: NewTaskValues): Promise<RepoResult<CreatedTask>>;

  /** List tasks with optional project/status/overdue/archived filters. */
  list(filters: TaskListFilters): Promise<RepoResult<TaskListRow[]>>;

  /** Fetch tasks by id (archived included). */
  findByIds(ids: string[]): Promise<RepoResult<TaskDetailRow[]>>;

  /** Apply a partial update to a task. */
  update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<void>>;

  /** Archive a task (sets `archived_at`; leaves status untouched). */
  archive(id: string): Promise<RepoResult<void>>;

  /**
   * Archive a task only if it is not already archived, also marking it done —
   * the reconciliation "removed from note" path (TaskExtractor Phase 5).
   */
  archiveIfActive(id: string): Promise<RepoResult<void>>;
}
