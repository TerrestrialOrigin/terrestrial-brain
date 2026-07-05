import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, McpToolResult, textResult } from "../mcp-response.ts";
import type {
  TaskListRow,
  TaskRepository,
} from "../repositories/task-repository.ts";
import { resolveNames } from "../repositories/name-resolution.ts";

/** Resolves a batch of ids to a `Map<id, displayValue>` (injected for testing). */
type NameResolver = (ids: string[]) => Promise<Map<string, string>>;

/**
 * Formats a list of tasks into the `list_tasks` text body. Pure — no DB, no
 * clock beyond overdue detection — so it is unit-testable directly.
 */
export function buildTaskListText(
  tasks: TaskListRow[],
  projectNames: Map<string, string>,
  personNames: Map<string, string>,
): string {
  const lines = tasks.map((task, index) => {
    const statusIcon = task.status === "done"
      ? "[x]"
      : task.status === "in_progress"
      ? "[~]"
      : "[ ]";
    const parts = [`${index + 1}. ${statusIcon} ${task.content}`];
    parts.push(`   ID: ${task.id} | Status: ${task.status}`);
    if (task.project_id && projectNames.get(task.project_id)) {
      parts.push(`   Project: ${projectNames.get(task.project_id)}`);
    }
    if (task.assigned_to && personNames.get(task.assigned_to)) {
      parts.push(`   Assigned to: ${personNames.get(task.assigned_to)}`);
    }
    if (task.due_by) {
      const due = new Date(task.due_by);
      const overdue = due < new Date() && task.status !== "done";
      parts.push(
        `   Due: ${due.toLocaleDateString()}${overdue ? " (OVERDUE)" : ""}`,
      );
    }
    return parts.join("\n");
  });

  return `${tasks.length} task(s):\n\n${lines.join("\n\n")}`;
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
  if (!data || data.length === 0) return textResult("No tasks found.");

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

  return textResult(buildTaskListText(data, projectNames, personNames));
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
        project_id: z.string().optional().describe(
          "UUID of the project this task belongs to",
        ),
        parent_id: z.string().optional().describe(
          "UUID of parent task for sub-tasks",
        ),
        due_by: z.string().optional().describe("Due date as ISO 8601 string"),
        status: z.string().optional().default("open").describe(
          "Status: open, in_progress, done, deferred",
        ),
        assigned_to: z.string().optional().describe(
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
        project_id: z.string().optional().describe("Filter by project UUID"),
        status: z.string().optional().describe(
          "Filter by status: open, in_progress, done, deferred",
        ),
        overdue_only: z.boolean().optional().default(false).describe(
          "Only show overdue tasks",
        ),
        include_archived: z.boolean().optional().default(false).describe(
          "Include archived tasks",
        ),
        limit: z.number().optional().default(20).describe("Max results"),
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
    "update_task",
    {
      title: "Update Task",
      description:
        "Update a task's content, status, due date, project assignment, or person assignment. " +
        "Setting status to 'done' automatically archives the task. " +
        "When the user says they finished something, started working on something, or wants to defer a task, use this to update the status accordingly. " +
        "Valid statuses: 'open' (not started), 'in_progress' (actively working), 'done' (completed, auto-archives), 'deferred' (postponed).",
      inputSchema: {
        id: z.string().describe("Task UUID"),
        content: z.string().optional().describe("New task description"),
        status: z.string().optional().describe(
          "New status: open, in_progress, done, deferred",
        ),
        due_by: z.string().nullable().optional().describe(
          "New due date (ISO 8601), or null to clear",
        ),
        project_id: z.string().nullable().optional().describe(
          "New project UUID, or null to unlink",
        ),
        assigned_to: z.string().nullable().optional().describe(
          "Person UUID to assign, or null to unassign",
        ),
      },
    },
    withMcpLogging(
      "update_task",
      async ({ id, content, status, due_by, project_id, assigned_to }) => {
        const updates: Record<string, unknown> = {};
        if (content !== undefined) updates.content = content;
        if (status !== undefined) updates.status = status;
        if (due_by !== undefined) updates.due_by = due_by;
        if (project_id !== undefined) updates.project_id = project_id;
        if (assigned_to !== undefined) updates.assigned_to = assigned_to;

        // Auto-archive when marked done
        if (status === "done") {
          updates.archived_at = new Date().toISOString();
        }

        if (Object.keys(updates).length === 0) {
          return textResult("No fields to update.");
        }

        const { error } = await taskRepository.update(id, updates);

        if (error) {
          return errorResult(`Update failed: ${error.message}`);
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
        id: z.string().describe("Task UUID to archive"),
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
        ids: z.array(z.string()).describe(
          "Array of task UUIDs to retrieve (max 50)",
        ),
      },
    },
    withMcpLogging("get_tasks", async ({ ids }) => {
      if (ids.length === 0) {
        return errorResult("Error: At least one task ID is required.");
      }

      if (ids.length > 50) {
        return errorResult("Error: Maximum 50 task IDs per request.");
      }

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

      return textResult(result);
    }, logger),
  );
}
