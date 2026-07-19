/**
 * SupabaseTaskRepository — the sole implementation of `TaskRepository`
 * (fix-plan Step 16). Every `tasks` table query formerly inline in
 * `tools/tasks.ts` / `extractors/task-extractor.ts` lives here. Each method
 * delegates its await-then-wrap to the shared `runQuery` / `runWrite` /
 * `runCount` helpers (REPO-3).
 */

import type { AppSupabaseClient, InsertRow } from "../supabase-client.ts";
import {
  type RepoResult,
  runCount,
  runQuery,
  runWrite,
} from "./repo-result.ts";
import type {
  CreatedTask,
  IncompleteTasksFilters,
  NewTaskValues,
  TaskDetailRow,
  TaskListFilters,
  TaskListRow,
  TaskReferenceRow,
  TaskRepository,
  TaskUpdate,
} from "./task-repository.ts";

export class SupabaseTaskRepository implements TaskRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  insert(values: NewTaskValues): Promise<RepoResult<CreatedTask>> {
    // `metadata` is jsonb, which typegen types as `Json`; the plain object we
    // build is a trusted internal payload. Documented narrow assertion.
    const insertRow = values as unknown as InsertRow<"tasks">;
    return runQuery(
      this.supabase
        .from("tasks")
        .insert(insertRow)
        .select("id, content")
        .single(),
    );
  }

  list(filters: TaskListFilters): Promise<RepoResult<TaskListRow[]>> {
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

    return runQuery(query);
  }

  listIncompleteUnarchived(
    filters: IncompleteTasksFilters,
  ): Promise<RepoResult<TaskListRow[]>> {
    // Exclude done (always) and — when the caller opts out — deferred. The
    // remaining statuses are the "incomplete" set. NOT IN keeps the query a
    // single round-trip regardless of how many statuses are excluded.
    const excluded = filters.includeDeferred ? ["done"] : ["done", "deferred"];
    return runQuery(
      this.supabase
        .from("tasks")
        .select(
          "id, content, status, due_by, project_id, assigned_to, archived_at, created_at",
        )
        .is("archived_at", null)
        .not("status", "in", `(${excluded.join(",")})`)
        // Overdue/soonest due first, undated last, then oldest-created first.
        .order("due_by", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        // Fetch one extra so the handler can tell "exactly at the cap" from
        // "more exist" and report truncation.
        .limit(filters.limit + 1),
    );
  }

  findByIds(ids: string[]): Promise<RepoResult<TaskDetailRow[]>> {
    return runQuery(
      this.supabase
        .from("tasks")
        .select(
          "id, content, status, due_by, project_id, parent_id, assigned_to, archived_at, created_at",
        )
        .in("id", ids),
    );
  }

  update(
    id: string,
    updates: TaskUpdate,
  ): Promise<RepoResult<{ id: string }>> {
    return runQuery(
      this.supabase
        .from("tasks")
        .update(updates)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    );
  }

  archive(id: string): Promise<RepoResult<void>> {
    // Claim-style: skip already-archived rows so a retried archive preserves
    // the original `archived_at` (matches `archiveIfActive`).
    return runWrite(
      this.supabase
        .from("tasks")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .is("archived_at", null),
    );
  }

  archiveIfActive(id: string): Promise<RepoResult<void>> {
    return runWrite(
      this.supabase
        .from("tasks")
        .update({ archived_at: new Date().toISOString(), status: "done" })
        .eq("id", id)
        .is("archived_at", null),
    );
  }

  countOpenByProject(projectId: string): Promise<RepoResult<number>> {
    // runCount keeps `data` null on failure — "broken" stays distinguishable
    // from "genuinely zero" (REPO-7).
    return runCount(
      this.supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId)
        .in("status", ["open", "in_progress"]),
    );
  }

  countOpenByAssignee(personId: string): Promise<RepoResult<number>> {
    // Same broken-vs-zero rule as countOpenByProject (REPO-7).
    return runCount(
      this.supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("assigned_to", personId)
        .in("status", ["open", "in_progress"])
        .is("archived_at", null),
    );
  }

  findOpenIdsByProjects(
    projectIds: string[],
  ): Promise<RepoResult<{ id: string }[]>> {
    return runQuery(
      this.supabase
        .from("tasks")
        .select("id")
        .in("project_id", projectIds)
        .is("archived_at", null)
        .in("status", ["open", "in_progress"]),
    );
  }

  archiveMany(ids: string[]): Promise<RepoResult<void>> {
    // Claim-style: skip already-archived rows so re-running the batch leaves
    // previously-archived tasks' `archived_at` untouched.
    return runWrite(
      this.supabase
        .from("tasks")
        .update({ archived_at: new Date().toISOString() })
        .in("id", ids)
        .is("archived_at", null),
    );
  }

  deleteByIds(ids: string[]): Promise<RepoResult<void>> {
    return runWrite(
      this.supabase
        .from("tasks")
        .delete()
        .in("id", ids),
    );
  }

  findByReference(
    referenceId: string,
  ): Promise<RepoResult<TaskReferenceRow[]>> {
    return runQuery(
      this.supabase
        .from("tasks")
        .select("id, content, reference_id")
        .eq("reference_id", referenceId),
    );
  }
}
