import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { uuidField } from "../zod-schemas.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, McpToolResult, textResult } from "../mcp-response.ts";
import { hashContent } from "../helpers.ts";
import type {
  TaskListRow,
  TaskRepository,
} from "../repositories/task-repository.ts";
import { resolveNames } from "../repositories/name-resolution.ts";
import { TASK_STATUSES } from "../enums.ts";
import {
  DEFAULT_GROUPED_TASK_LIMIT,
  DEFAULT_LIST_LIMIT,
  MAX_GROUPED_TASK_LIMIT,
  MAX_QUERY_LIMIT,
} from "../constants.ts";

/** Resolves a batch of ids to a `Map<id, displayValue>` (injected for testing). */
type NameResolver = (ids: string[]) => Promise<Map<string, string>>;

/** Optional display context for a single rendered task line. */
interface TaskLineContext {
  /** When present, a `Project:` line is added for tasks with a resolved name. */
  projectNames?: Map<string, string>;
  personNames: Map<string, string>;
}

/**
 * Renders one task as its numbered multi-line block (status icon, id/status,
 * optional project + assignee, due date with overdue marker). Shared by
 * `list_tasks` and `list_open_tasks_by_project` so a task looks identical
 * wherever it appears. Pure apart from `new Date()` for overdue detection.
 */
export function renderTaskLine(
  task: TaskListRow,
  position: number,
  context: TaskLineContext,
): string {
  const statusIcon = task.status === "done"
    ? "[x]"
    : task.status === "in_progress"
    ? "[~]"
    : "[ ]";
  const parts = [`${position}. ${statusIcon} ${task.content}`];
  parts.push(`   ID: ${task.id} | Status: ${task.status}`);
  const projectName = task.project_id
    ? context.projectNames?.get(task.project_id)
    : undefined;
  if (projectName) {
    parts.push(`   Project: ${projectName}`);
  }
  const personName = task.assigned_to
    ? context.personNames.get(task.assigned_to)
    : undefined;
  if (personName) {
    parts.push(`   Assigned to: ${personName}`);
  }
  if (task.due_by) {
    const due = new Date(task.due_by);
    const overdue = due < new Date() && task.status !== "done";
    parts.push(
      `   Due: ${due.toLocaleDateString()}${overdue ? " (OVERDUE)" : ""}`,
    );
  }
  return parts.join("\n");
}

/**
 * Formats a list of tasks into the `list_tasks` text body. Pure — no DB, no
 * clock beyond overdue detection — so it is unit-testable directly.
 */
export function buildTaskListText(
  tasks: TaskListRow[],
  projectNames: Map<string, string>,
  personNames: Map<string, string>,
): string {
  const lines = tasks.map((task, index) =>
    renderTaskLine(task, index + 1, { projectNames, personNames })
  );
  return `${tasks.length} task(s):\n\n${lines.join("\n\n")}`;
}

/** A project (or the no-project bucket) with its tasks, ready to render. */
interface RenderableTaskGroup {
  heading: string;
  /** 0 = known project, 1 = unknown/deleted project, 2 = the no-project bucket. */
  rank: number;
  sortKey: string;
  tasks: TaskListRow[];
}

/**
 * Groups incomplete tasks by project for `list_open_tasks_by_project`. Pure.
 * Tasks arrive already globally sorted, so within-group order is preserved.
 * Group order: known projects alphabetical by name, then unknown-project
 * groups, then the "(No project)" bucket last. A task whose `project_id` does
 * not resolve to a name is grouped under "(Unknown project <id>)" rather than
 * dropped. Numbering restarts within each group.
 */
export function buildOpenTasksByProjectText(
  tasks: TaskListRow[],
  projectNames: Map<string, string>,
  personNames: Map<string, string>,
  options: { truncated: boolean; limit: number },
): string {
  const byProject = new Map<string, TaskListRow[]>();
  const noProject: TaskListRow[] = [];
  for (const task of tasks) {
    if (!task.project_id) {
      noProject.push(task);
      continue;
    }
    const bucket = byProject.get(task.project_id) ?? [];
    bucket.push(task);
    byProject.set(task.project_id, bucket);
  }

  const groups: RenderableTaskGroup[] = [];
  for (const [projectId, groupTasks] of byProject) {
    const name = projectNames.get(projectId);
    if (name === undefined) {
      groups.push({
        heading: `(Unknown project ${projectId})`,
        rank: 1,
        sortKey: projectId,
        tasks: groupTasks,
      });
    } else {
      groups.push({
        heading: name,
        rank: 0,
        sortKey: name.toLowerCase(),
        tasks: groupTasks,
      });
    }
  }
  if (noProject.length > 0) {
    groups.push({
      heading: "(No project)",
      rank: 2,
      sortKey: "",
      tasks: noProject,
    });
  }
  groups.sort((a, b) => a.rank - b.rank || a.sortKey.localeCompare(b.sortKey));

  const sections = groups.map((group) => {
    const lines = group.tasks.map((task, index) =>
      renderTaskLine(task, index + 1, { personNames })
    );
    return `## ${group.heading} (${group.tasks.length})\n${lines.join("\n\n")}`;
  });

  const header =
    `${tasks.length} open task(s) across ${groups.length} group(s):`;
  let body = `${header}\n\n${sections.join("\n\n")}`;
  if (options.truncated) {
    body += `\n\n⚠️ Showing the first ${options.limit} tasks; more exist. ` +
      `Narrow with list_tasks or filter by a single project.`;
  }
  return body;
}

/**
 * `list_tasks` logic, with the DB and name-resolution behind injected seams so a
 * unit test can drive it with a fake `TaskRepository` and fake resolvers — no
 * database (fix-plan Step 16, D5).
 */
export async function handleListTasks(
  taskRepository: TaskRepository,
  resolveProjects: NameResolver,
  resolvePersons: NameResolver,
  args: {
    project_id?: string;
    status?: string;
    overdue_only: boolean;
    include_archived: boolean;
    limit: number;
  },
): Promise<McpToolResult> {
  const { data, error } = await taskRepository.list({
    limit: args.limit,
    includeArchived: args.include_archived,
    overdueOnly: args.overdue_only,
    projectId: args.project_id,
    status: args.status,
  });

  if (error) return errorResult(`Error: ${error.message}`);
  if (!data || data.length === 0) {
    return textResult("No tasks found.", { recordsReturned: 0 });
  }

  const projectIds = data.flatMap((task) =>
    task.project_id ? [task.project_id] : []
  );
  const projectNames = projectIds.length > 0
    ? await resolveProjects(projectIds)
    : new Map<string, string>();

  const personIds = data.flatMap((task) =>
    task.assigned_to ? [task.assigned_to] : []
  );
  const personNames = personIds.length > 0
    ? await resolvePersons(personIds)
    : new Map<string, string>();

  return textResult(buildTaskListText(data, projectNames, personNames), {
    recordsReturned: data.length,
  });
}

/**
 * `list_open_tasks_by_project` logic behind injected seams (fake repository +
 * fake resolvers → no DB in unit tests). Fetches every incomplete unarchived
 * task (bounded), detects truncation via the `limit + 1` probe, resolves
 * project/person names in one batch each, and renders the grouped body.
 * Reports the real emitted count + ids to the logger via `meta`.
 */
export async function handleOpenTasksByProject(
  taskRepository: TaskRepository,
  resolveProjects: NameResolver,
  resolvePersons: NameResolver,
  args: { limit: number; include_deferred: boolean },
): Promise<McpToolResult> {
  const { data, error } = await taskRepository.listIncompleteUnarchived({
    limit: args.limit,
    includeDeferred: args.include_deferred,
  });

  if (error) return errorResult(`Error: ${error.message}`);

  const rows = data ?? [];
  // The repository fetched `limit + 1`; more than `limit` means it was capped.
  const truncated = rows.length > args.limit;
  const tasks = truncated ? rows.slice(0, args.limit) : rows;

  if (tasks.length === 0) {
    return textResult("No open tasks.", { recordsReturned: 0 });
  }

  const projectIds = tasks.flatMap((task) =>
    task.project_id ? [task.project_id] : []
  );
  const projectNames = projectIds.length > 0
    ? await resolveProjects(projectIds)
    : new Map<string, string>();

  const personIds = tasks.flatMap((task) =>
    task.assigned_to ? [task.assigned_to] : []
  );
  const personNames = personIds.length > 0
    ? await resolvePersons(personIds)
    : new Map<string, string>();

  const body = buildOpenTasksByProjectText(tasks, projectNames, personNames, {
    truncated,
    limit: args.limit,
  });
  return textResult(body, {
    recordsReturned: tasks.length,
    returnedIds: tasks.map((task) => task.id),
  });
}

export function register(
  server: McpServer,
  supabase: SupabaseClient,
  logger: FunctionCallLogger,
  taskRepository: TaskRepository,
) {
  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description:
        "Create a single task, optionally linked to a project and/or assigned to a person. " +
        "Use this for ad-hoc tasks the user mentions in conversation. " +
        "Use assigned_to with a person UUID to assign the task (use list_people to find person IDs). " +
        "For creating multiple related tasks at once (e.g. a sprint plan or checklist), prefer create_tasks_with_output — " +
        "it creates structured task rows AND delivers a markdown checklist to the user's Obsidian vault in one call.",
      inputSchema: {
        content: z.string().describe("Task description"),
        project_id: uuidField().optional().describe(
          "UUID of the project this task belongs to",
        ),
        parent_id: uuidField().optional().describe(
          "UUID of parent task for sub-tasks",
        ),
        due_by: z.string().optional().describe("Due date as ISO 8601 string"),
        status: z.enum(TASK_STATUSES).optional().default("open").describe(
          "Status: open, in_progress, done, deferred",
        ),
        assigned_to: uuidField().optional().describe(
          "UUID of the person this task is assigned to",
        ),
      },
    },
    withMcpLogging(
      "create_task",
      async (
        { content, project_id, parent_id, due_by, status, assigned_to },
      ) => {
        const { data, error } = await taskRepository.insert({
          content,
          status: status || "open",
          project_id: project_id || null,
          parent_id: parent_id || null,
          due_by: due_by || null,
          assigned_to: assigned_to || null,
        });

        if (error || !data) {
          return errorResult(
            `Failed to create task: ${error?.message ?? "unknown error"}`,
          );
        }

        return textResult(`Created task (id: ${data.id}): "${content}"`);
      },
      logger,
    ),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description: "List tasks with optional filters. Common uses: " +
        "filter by project_id to see a project's task list, " +
        "filter by status='open' to see what needs doing, " +
        "set overdue_only=true to find tasks past their due date. " +
        "Results include project names and assigned person names for context.",
      inputSchema: {
        project_id: uuidField().optional().describe(
          "Filter by project UUID",
        ),
        status: z.enum(TASK_STATUSES).optional().describe(
          "Filter by status: open, in_progress, done, deferred",
        ),
        overdue_only: z.boolean().optional().default(false).describe(
          "Only show overdue tasks",
        ),
        include_archived: z.boolean().optional().default(false).describe(
          "Include archived tasks",
        ),
        limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional().default(
          DEFAULT_LIST_LIMIT,
        ).describe(
          "Max results (default 20, max 100)",
        ),
      },
    },
    withMcpLogging(
      "list_tasks",
      ({ project_id, status, overdue_only, include_archived, limit }) =>
        handleListTasks(
          taskRepository,
          (ids) => resolveNames(supabase, "projects", ids),
          (ids) => resolveNames(supabase, "people", ids),
          { project_id, status, overdue_only, include_archived, limit },
        ),
      logger,
    ),
  );

  server.registerTool(
    "list_open_tasks_by_project",
    {
      title: "List Open Tasks by Project",
      description:
        "Return ALL incomplete (not done), unarchived tasks across every project, " +
        "grouped by project, in one call. Tasks with no project are collected in a " +
        '"(No project)" group rendered last. Use this for a whole-brain ' +
        "\"what's on my plate, by project\" review; for a single project's list or " +
        "status/overdue filtering use list_tasks. Deferred tasks are included by " +
        "default — pass include_deferred=false for only actionable (open/in_progress) " +
        "work. Results are bounded (default 500, max 1000) and report truncation.",
      inputSchema: {
        include_deferred: z.boolean().optional().default(true).describe(
          "Include deferred tasks in the incomplete set (default true)",
        ),
        limit: z.number().int().min(1).max(MAX_GROUPED_TASK_LIMIT).optional()
          .default(DEFAULT_GROUPED_TASK_LIMIT).describe(
            "Max tasks fetched across all groups (default 500, max 1000); " +
              "truncation past the cap is reported",
          ),
      },
    },
    withMcpLogging(
      "list_open_tasks_by_project",
      ({ include_deferred, limit }) =>
        handleOpenTasksByProject(
          taskRepository,
          (ids) => resolveNames(supabase, "projects", ids),
          (ids) => resolveNames(supabase, "people", ids),
          { include_deferred, limit },
        ),
      logger,
    ),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update Task",
      description:
        "Update a task's content, status, due date, project assignment, or person assignment. " +
        "Setting status to 'done' automatically archives the task. " +
        "When the user says they finished something, started working on something, or wants to defer a task, use this to update the status accordingly. " +
        "Valid statuses: 'open' (not started), 'in_progress' (actively working), 'done' (completed, auto-archives), 'deferred' (postponed).",
      inputSchema: {
        id: uuidField().describe("Task UUID"),
        content: z.string().optional().describe("New task description"),
        status: z.enum(TASK_STATUSES).optional().describe(
          "New status: open, in_progress, done, deferred",
        ),
        due_by: z.string().nullable().optional().describe(
          "New due date (ISO 8601), or null to clear",
        ),
        project_id: uuidField().nullable().optional().describe(
          "New project UUID, or null to unlink",
        ),
        assigned_to: uuidField().nullable().optional().describe(
          "Person UUID to assign, or null to unassign",
        ),
      },
    },
    withMcpLogging(
      "update_task",
      async ({ id, content, status, due_by, project_id, assigned_to }) => {
        const updates: Record<string, unknown> = {};
        if (content !== undefined) {
          updates.content = content;
          // INVARIANT 1: re-hash on every content edit (one update path).
          updates.content_hash = await hashContent(content);
        }
        if (status !== undefined) updates.status = status;
        if (due_by !== undefined) updates.due_by = due_by;
        if (project_id !== undefined) updates.project_id = project_id;
        if (assigned_to !== undefined) updates.assigned_to = assigned_to;

        // Auto-archive when marked done
        if (status === "done") {
          updates.archived_at = new Date().toISOString();
        }

        if (Object.keys(updates).length === 0) {
          return errorResult(
            "At least one of content, status, due_by, project_id, or assigned_to must be provided.",
          );
        }

        const { data, error } = await taskRepository.update(id, updates);

        if (error) {
          return errorResult(`Update failed: ${error.message}`);
        }
        if (!data) {
          // Affected-row verification: no row matched — report not-found.
          return errorResult(`Task not found: no task with id ${id}`);
        }

        return textResult(
          `Task ${id} updated: ${Object.keys(updates).join(", ")}`,
        );
      },
      logger,
    ),
  );

  server.registerTool(
    "archive_task",
    {
      title: "Archive Task",
      description: "Archive a task without changing its status. " +
        "Use this to hide tasks that are no longer relevant but weren't completed (e.g. cancelled or superseded). " +
        "For tasks the user actually finished, prefer update_task with status='done' — that both marks completion and archives in one step.",
      inputSchema: {
        id: uuidField().describe("Task UUID to archive"),
      },
    },
    withMcpLogging("archive_task", async ({ id }) => {
      const { error } = await taskRepository.archive(id);

      if (error) {
        return errorResult(`Archive failed: ${error.message}`);
      }

      return textResult(`Task ${id} archived.`);
    }, logger),
  );

  server.registerTool(
    "get_tasks",
    {
      title: "Get Tasks by ID",
      description:
        "Retrieve one or more tasks by their UUIDs. Returns full task details including " +
        "resolved project name, assigned person name, parent task content, and overdue detection. " +
        "Use this when you already have task IDs (e.g. from create_task, get_project_summary, or prior conversation) " +
        "and need to check their current state. Archived tasks are included — if you ask for an ID, you get it.",
      inputSchema: {
        ids: uuidField().array().min(1).max(50).describe(
          "Array of task UUIDs to retrieve (1–50)",
        ),
      },
    },
    withMcpLogging("get_tasks", async ({ ids }) => {
      // Empty/oversized `ids` are rejected at the schema boundary (min 1,
      // max 50), so no imperative length check is needed here.
      const { data, error } = await taskRepository.findByIds(ids);

      if (error) {
        return errorResult(`Error: ${error.message}`);
      }

      const foundIds = new Set((data || []).map((task) => task.id));
      const missingIds = ids.filter((requestedId: string) =>
        !foundIds.has(requestedId)
      );

      if (!data || data.length === 0) {
        return textResult(
          `No tasks found. Missing IDs: ${missingIds.join(", ")}`,
          { recordsReturned: 0 },
        );
      }

      // Batch-resolve project, assignee, and parent-task names via the shared
      // helper (one query each; raw-id fallback on error — finding C9).
      const projectIds = data.flatMap((task) =>
        task.project_id ? [task.project_id] : []
      );
      const projectMap = projectIds.length > 0
        ? await resolveNames(supabase, "projects", projectIds)
        : new Map<string, string>();

      const personIds = data.flatMap((task) =>
        task.assigned_to ? [task.assigned_to] : []
      );
      const personMap = personIds.length > 0
        ? await resolveNames(supabase, "people", personIds)
        : new Map<string, string>();

      const parentIds = data.flatMap((task) =>
        task.parent_id ? [task.parent_id] : []
      );
      const parentMap = parentIds.length > 0
        ? await resolveNames(supabase, "tasks", parentIds, "content")
        : new Map<string, string>();

      const lines = data.map((task, index) => {
        const statusIcon = task.status === "done"
          ? "[x]"
          : task.status === "in_progress"
          ? "[~]"
          : "[ ]";
        const parts = [`${index + 1}. ${statusIcon} ${task.content}`];
        parts.push(`   ID: ${task.id} | Status: ${task.status}`);
        if (task.project_id && projectMap.get(task.project_id)) {
          parts.push(`   Project: ${projectMap.get(task.project_id)}`);
        }
        if (task.assigned_to && personMap.get(task.assigned_to)) {
          parts.push(`   Assigned to: ${personMap.get(task.assigned_to)}`);
        }
        if (task.parent_id && parentMap.get(task.parent_id)) {
          parts.push(`   Parent task: ${parentMap.get(task.parent_id)}`);
        }
        if (task.due_by) {
          const due = new Date(task.due_by);
          const overdue = due < new Date() && task.status !== "done";
          parts.push(
            `   Due: ${due.toLocaleDateString()}${overdue ? " (OVERDUE)" : ""}`,
          );
        }
        if (task.archived_at) {
          parts.push(
            `   Archived: ${new Date(task.archived_at).toLocaleDateString()}`,
          );
        }
        return parts.join("\n");
      });

      let result = `${data.length} task(s):\n\n${lines.join("\n\n")}`;
      if (missingIds.length > 0) {
        result += `\n\nNot found (${missingIds.length}): ${
          missingIds.join(", ")
        }`;
      }

      return textResult(result, { recordsReturned: data.length });
    }, logger),
  );

  // Tool: Reconcile Tasks — propose open tasks to review for completion. This is
  // a CONSENT surface: it surfaces open tasks so the model can check them against
  // recent thoughts and ASK the user before closing any. It NEVER auto-closes —
  // closing still goes through update_task (status: done) after confirmation.
  server.registerTool(
    "reconcile_tasks",
    {
      title: "Reconcile Tasks",
      description:
        "Return open tasks to reconcile against recent activity. For each, judge " +
        "from recent thoughts whether it looks completed; if so, ASK the user to " +
        "confirm before closing it (via update_task status: done). This tool " +
        "NEVER changes any task status itself — it only proposes candidates. For " +
        "a PMS-origin task, surface the consented-close choice; on decline it " +
        "stays open.",
      inputSchema: {
        project_id: uuidField().optional().describe(
          "Optional: only reconcile open tasks in this project",
        ),
      },
    },
    withMcpLogging("reconcile_tasks", async ({ project_id }) => {
      const { data, error } = await taskRepository.list({
        limit: 100,
        includeArchived: false,
        overdueOnly: false,
        status: "open",
        ...(project_id ? { projectId: project_id } : {}),
      });
      if (error) return errorResult(`Reconcile query failed: ${error.message}`);
      const rows = data ?? [];
      if (rows.length === 0) {
        return textResult("No open tasks to reconcile.");
      }
      const lines = rows.map((task) => `- ${task.id}: "${task.content}"`);
      return textResult(
        `${rows.length} open task(s) to reconcile (confirm with the user before ` +
          `closing any — this tool does not change status):\n${
            lines.join("\n")
          }`,
        { recordsReturned: rows.length },
      );
    }, logger),
  );
}
