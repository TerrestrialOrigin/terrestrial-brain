import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";

export function register(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description:
        "Create a single task, optionally linked to a project. " +
        "Use this for ad-hoc tasks the user mentions in conversation. " +
        "For creating multiple related tasks at once (e.g. a sprint plan or checklist), prefer create_tasks_with_output — " +
        "it creates structured task rows AND delivers a markdown checklist to the user's Obsidian vault in one call.",
      inputSchema: {
        content: z.string().describe("Task description"),
        project_id: z.string().optional().describe("UUID of the project this task belongs to"),
        parent_id: z.string().optional().describe("UUID of parent task for sub-tasks"),
        due_by: z.string().optional().describe("Due date as ISO 8601 string"),
        status: z.string().optional().default("open").describe("Status: open, in_progress, done, deferred"),
      },
    },
    async ({ content, project_id, parent_id, due_by, status }) => {
      try {
        const { data, error } = await supabase
          .from("tasks")
          .insert({
            content,
            status: status || "open",
            project_id: project_id || null,
            parent_id: parent_id || null,
            due_by: due_by || null,
          })
          .select("id")
          .single();

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to create task: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Created task (id: ${data.id}): "${content}"` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description:
        "List tasks with optional filters. Common uses: " +
        "filter by project_id to see a project's task list, " +
        "filter by status='open' to see what needs doing, " +
        "set overdue_only=true to find tasks past their due date. " +
        "Results include project names for context.",
      inputSchema: {
        project_id: z.string().optional().describe("Filter by project UUID"),
        status: z.string().optional().describe("Filter by status: open, in_progress, done, deferred"),
        overdue_only: z.boolean().optional().default(false).describe("Only show overdue tasks"),
        include_archived: z.boolean().optional().default(false).describe("Include archived tasks"),
        limit: z.number().optional().default(20).describe("Max results"),
      },
    },
    async ({ project_id, status, overdue_only, include_archived, limit }) => {
      try {
        let q = supabase
          .from("tasks")
          .select("id, content, status, due_by, project_id, archived_at, created_at")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (!include_archived) q = q.is("archived_at", null);
        if (project_id) q = q.eq("project_id", project_id);
        if (status) q = q.eq("status", status);
        if (overdue_only) {
          q = q.lt("due_by", new Date().toISOString()).neq("status", "done");
        }

        const { data, error } = await q;

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || data.length === 0) {
          return { content: [{ type: "text" as const, text: "No tasks found." }] };
        }

        // Get project names
        const projectIds = [...new Set(data.filter(t => t.project_id).map(t => t.project_id))];
        let projectMap: Record<string, string> = {};
        if (projectIds.length > 0) {
          const { data: projects } = await supabase
            .from("projects")
            .select("id, name")
            .in("id", projectIds);
          projectMap = Object.fromEntries((projects || []).map(p => [p.id, p.name]));
        }

        const lines = data.map((t, i) => {
          const statusIcon = t.status === "done" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
          const parts = [`${i + 1}. ${statusIcon} ${t.content}`];
          parts.push(`   ID: ${t.id} | Status: ${t.status}`);
          if (t.project_id && projectMap[t.project_id])
            parts.push(`   Project: ${projectMap[t.project_id]}`);
          if (t.due_by) {
            const due = new Date(t.due_by);
            const overdue = due < new Date() && t.status !== "done";
            parts.push(`   Due: ${due.toLocaleDateString()}${overdue ? " (OVERDUE)" : ""}`);
          }
          return parts.join("\n");
        });

        return {
          content: [{ type: "text" as const, text: `${data.length} task(s):\n\n${lines.join("\n\n")}` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      title: "Update Task",
      description:
        "Update a task's content, status, due date, or project assignment. " +
        "Setting status to 'done' automatically archives the task. " +
        "When the user says they finished something, started working on something, or wants to defer a task, use this to update the status accordingly. " +
        "Valid statuses: 'open' (not started), 'in_progress' (actively working), 'done' (completed, auto-archives), 'deferred' (postponed).",
      inputSchema: {
        id: z.string().describe("Task UUID"),
        content: z.string().optional().describe("New task description"),
        status: z.string().optional().describe("New status: open, in_progress, done, deferred"),
        due_by: z.string().nullable().optional().describe("New due date (ISO 8601), or null to clear"),
        project_id: z.string().nullable().optional().describe("New project UUID, or null to unlink"),
      },
    },
    async ({ id, content, status, due_by, project_id }) => {
      try {
        const updates: Record<string, unknown> = {};
        if (content !== undefined) updates.content = content;
        if (status !== undefined) updates.status = status;
        if (due_by !== undefined) updates.due_by = due_by;
        if (project_id !== undefined) updates.project_id = project_id;

        // Auto-archive when marked done
        if (status === "done") {
          updates.archived_at = new Date().toISOString();
        }

        if (Object.keys(updates).length === 0) {
          return { content: [{ type: "text" as const, text: "No fields to update." }] };
        }

        const { error } = await supabase
          .from("tasks")
          .update(updates)
          .eq("id", id);

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Update failed: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Task ${id} updated: ${Object.keys(updates).join(", ")}` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "archive_task",
    {
      title: "Archive Task",
      description:
        "Archive a task without changing its status. " +
        "Use this to hide tasks that are no longer relevant but weren't completed (e.g. cancelled or superseded). " +
        "For tasks the user actually finished, prefer update_task with status='done' — that both marks completion and archives in one step.",
      inputSchema: {
        id: z.string().describe("Task UUID to archive"),
      },
    },
    async ({ id }) => {
      try {
        const { error } = await supabase
          .from("tasks")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", id);

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Archive failed: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Task ${id} archived.` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}
