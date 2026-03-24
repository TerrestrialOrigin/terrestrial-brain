import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract project IDs from a thought's metadata.references, handling both
 * old format ({ project_id: "uuid" }) and new format ({ projects: ["uuid"] }).
 */
function getProjectRefsFromMetadata(metadata: Record<string, unknown>): string[] {
  const refs = metadata?.references as Record<string, unknown> | undefined;
  if (!refs) return [];
  if (Array.isArray(refs.projects)) return refs.projects as string[];
  if (typeof refs.project_id === "string") return [refs.project_id];
  return [];
}

/**
 * Format a date for display. Returns locale date string or "—" if null.
 */
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function register(server: McpServer, supabase: SupabaseClient) {
  // ─── get_project_summary ─────────────────────────────────────────────────

  server.registerTool(
    "get_project_summary",
    {
      title: "Get Project Summary",
      description:
        "Get a comprehensive summary of a project in a single call: project details (name, type, description), child projects, " +
        "all open tasks, recent thoughts referencing this project, and source notes from Obsidian. " +
        "This is the best starting point when the user asks about a specific project — it gives you the full picture " +
        "so you can answer follow-up questions without additional calls. Prefer this over get_project for richer context.",
      inputSchema: {
        id: z.string().describe("Project UUID"),
      },
    },
    async ({ id }) => {
      try {
        // 1. Fetch project
        const { data: project, error: projectError } = await supabase
          .from("projects")
          .select("*")
          .eq("id", id)
          .single();

        if (projectError || !project) {
          return {
            content: [{ type: "text" as const, text: `Project not found: ${projectError?.message || "unknown"}` }],
            isError: true,
          };
        }

        // 2. Fetch parent name
        let parentName: string | null = null;
        if (project.parent_id) {
          const { data: parent } = await supabase
            .from("projects")
            .select("name")
            .eq("id", project.parent_id)
            .single();
          parentName = parent?.name || null;
        }

        // 3. Fetch children
        const { data: children } = await supabase
          .from("projects")
          .select("id, name, type")
          .eq("parent_id", id)
          .is("archived_at", null)
          .order("name");

        // 4. Fetch open tasks
        const { data: tasks } = await supabase
          .from("tasks")
          .select("id, content, status, due_by, assigned_to, created_at")
          .eq("project_id", id)
          .is("archived_at", null)
          .in("status", ["open", "in_progress"])
          .order("created_at", { ascending: false });

        // 5. Fetch recent thoughts that reference this project
        // Query a broader set and filter in-app for backwards compatibility
        const { data: allRecentThoughts } = await supabase
          .from("thoughts")
          .select("id, content, metadata, note_snapshot_id, created_at")
          .order("created_at", { ascending: false })
          .limit(200);

        const matchingThoughts = (allRecentThoughts || [])
          .filter((thought: { metadata: Record<string, unknown> }) => {
            const projectRefs = getProjectRefsFromMetadata(thought.metadata);
            return projectRefs.includes(id);
          })
          .slice(0, 10);

        // 6. Fetch source note snapshots for matching thoughts
        const snapshotIds = [
          ...new Set(
            matchingThoughts
              .filter((thought: { note_snapshot_id: string | null }) => thought.note_snapshot_id)
              .map((thought: { note_snapshot_id: string }) => thought.note_snapshot_id)
          ),
        ];

        let snapshotMap: Record<string, { title: string | null; reference_id: string }> = {};
        if (snapshotIds.length > 0) {
          const { data: snapshots } = await supabase
            .from("note_snapshots")
            .select("id, title, reference_id")
            .in("id", snapshotIds);

          snapshotMap = Object.fromEntries(
            (snapshots || []).map((snapshot: { id: string; title: string | null; reference_id: string }) => [
              snapshot.id,
              { title: snapshot.title, reference_id: snapshot.reference_id },
            ])
          );
        }

        // 6b. Resolve assigned person names for tasks
        const taskPersonIds = [
          ...new Set(
            (tasks || [])
              .filter((task: { assigned_to: string | null }) => task.assigned_to)
              .map((task: { assigned_to: string }) => task.assigned_to)
          ),
        ];
        let personMap: Record<string, string> = {};
        if (taskPersonIds.length > 0) {
          const { data: people } = await supabase
            .from("people")
            .select("id, name")
            .in("id", taskPersonIds);
          personMap = Object.fromEntries(
            (people || []).map((person: { id: string; name: string }) => [person.id, person.name])
          );
        }

        // ─── Format output ───────────────────────────────────────────────────

        const sections: string[] = [];

        // Project details
        const detailLines = [
          `# ${project.name}`,
          "",
          `**Type:** ${project.type || "—"}`,
          `**Description:** ${project.description || "—"}`,
        ];
        if (parentName) {
          detailLines.push(`**Parent:** ${parentName} (${project.parent_id})`);
        }
        if (project.archived_at) {
          detailLines.push(`**Archived:** ${formatDate(project.archived_at)}`);
        }
        detailLines.push(
          `**Created:** ${formatDate(project.created_at)}`,
          `**Updated:** ${formatDate(project.updated_at)}`
        );
        sections.push(detailLines.join("\n"));

        // Children
        if (children && children.length > 0) {
          const childLines = [
            "",
            `## Child Projects (${children.length})`,
            "",
            ...children.map(
              (child: { name: string; type: string | null; id: string }) =>
                `- ${child.name} (${child.type || "—"}) — ${child.id}`
            ),
          ];
          sections.push(childLines.join("\n"));
        }

        // Open tasks
        const taskList = tasks || [];
        const taskLines = ["", `## Open Tasks (${taskList.length})`];
        if (taskList.length === 0) {
          taskLines.push("", "No open tasks.");
        } else {
          taskLines.push("");
          for (const task of taskList) {
            const statusIcon = task.status === "in_progress" ? "[~]" : "[ ]";
            const duePart = task.due_by
              ? ` — due ${formatDate(task.due_by)}${new Date(task.due_by) < new Date() ? " (OVERDUE)" : ""}`
              : "";
            const assigneePart = task.assigned_to && personMap[task.assigned_to]
              ? ` (${personMap[task.assigned_to]})`
              : "";
            taskLines.push(`- ${statusIcon} ${task.content}${assigneePart}${duePart}`);
          }
        }
        sections.push(taskLines.join("\n"));

        // Recent thoughts
        const thoughtLines = ["", `## Recent Thoughts (${matchingThoughts.length})`];
        if (matchingThoughts.length === 0) {
          thoughtLines.push("", "No recent thoughts referencing this project.");
        } else {
          thoughtLines.push("");
          for (const thought of matchingThoughts) {
            const meta = (thought.metadata || {}) as Record<string, unknown>;
            const typeLabel = (meta.type as string) || "unknown";
            thoughtLines.push(
              `- [${formatDate(thought.created_at)}] (${typeLabel}) ${thought.content}`
            );
          }
        }
        sections.push(thoughtLines.join("\n"));

        // Source notes
        const uniqueSnapshots = Object.values(snapshotMap);
        if (uniqueSnapshots.length > 0) {
          const noteLines = [
            "",
            `## Source Notes (${uniqueSnapshots.length})`,
            "",
            ...uniqueSnapshots.map(
              (snapshot) => `- ${snapshot.title || snapshot.reference_id} (${snapshot.reference_id})`
            ),
          ];
          sections.push(noteLines.join("\n"));
        }

        return {
          content: [{ type: "text" as const, text: sections.join("\n") }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── get_recent_activity ─────────────────────────────────────────────────

  server.registerTool(
    "get_recent_activity",
    {
      title: "Get Recent Activity",
      description:
        "Get a cross-table summary of recent activity across the entire knowledge base: new thoughts captured, tasks created, " +
        "tasks completed, project updates, and AI outputs delivered. " +
        "Use this as a conversation opener when the user asks 'what's been going on?', 'catch me up', or 'what happened this week?'. " +
        "Also useful for your own orientation at the start of a session to understand the user's recent context.",
      inputSchema: {
        days: z.number().optional().default(7).describe("Number of days to look back (default 7)"),
      },
    },
    async ({ days }) => {
      try {
        const effectiveDays = Math.max(1, days);
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - effectiveDays);
        const sinceIso = sinceDate.toISOString();

        // 1. Recent thoughts
        const { data: thoughts } = await supabase
          .from("thoughts")
          .select("content, metadata, created_at")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(20);

        // 2. Tasks created
        const { data: tasksCreated } = await supabase
          .from("tasks")
          .select("content, status, project_id, created_at")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false });

        // 3. Tasks completed (done + updated recently)
        const { data: tasksCompleted } = await supabase
          .from("tasks")
          .select("content, project_id, updated_at")
          .eq("status", "done")
          .gte("updated_at", sinceIso)
          .order("updated_at", { ascending: false });

        // 4. Projects created or updated
        const { data: projectsCreated } = await supabase
          .from("projects")
          .select("name, type, created_at")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false });

        const { data: projectsUpdated } = await supabase
          .from("projects")
          .select("name, type, updated_at")
          .gte("updated_at", sinceIso)
          .order("updated_at", { ascending: false });

        // Deduplicate projects (could appear in both created and updated)
        const allProjectNames = new Set<string>();
        const projectEntries: { name: string; type: string | null; action: string; date: string }[] = [];

        for (const project of projectsCreated || []) {
          allProjectNames.add(project.name);
          projectEntries.push({ name: project.name, type: project.type, action: "created", date: project.created_at });
        }
        for (const project of projectsUpdated || []) {
          if (!allProjectNames.has(project.name)) {
            allProjectNames.add(project.name);
            projectEntries.push({ name: project.name, type: project.type, action: "updated", date: project.updated_at });
          }
        }

        // 5. AI outputs delivered
        const { data: aiOutputs } = await supabase
          .from("ai_output")
          .select("title, file_path, picked_up_at")
          .eq("picked_up", true)
          .gte("picked_up_at", sinceIso)
          .order("picked_up_at", { ascending: false });

        // Collect project IDs for name resolution
        const projectIdSet = new Set<string>();
        for (const task of tasksCreated || []) {
          if (task.project_id) projectIdSet.add(task.project_id);
        }
        for (const task of tasksCompleted || []) {
          if (task.project_id) projectIdSet.add(task.project_id);
        }

        let projectNameMap: Record<string, string> = {};
        if (projectIdSet.size > 0) {
          const { data: projects } = await supabase
            .from("projects")
            .select("id, name")
            .in("id", [...projectIdSet]);
          projectNameMap = Object.fromEntries(
            (projects || []).map((project: { id: string; name: string }) => [project.id, project.name])
          );
        }

        // ─── Format output ───────────────────────────────────────────────────

        const sections: string[] = [];
        sections.push(`# Activity — Last ${effectiveDays} Day${effectiveDays !== 1 ? "s" : ""}`);

        // Thoughts
        const thoughtList = thoughts || [];
        sections.push("", `## Thoughts (${thoughtList.length})`);
        if (thoughtList.length === 0) {
          sections.push("", "No new thoughts.");
        } else {
          sections.push("");
          for (const thought of thoughtList) {
            const meta = (thought.metadata || {}) as Record<string, unknown>;
            const typeLabel = (meta.type as string) || "unknown";
            sections.push(`- [${formatDate(thought.created_at)}] (${typeLabel}) ${thought.content}`);
          }
        }

        // Tasks created
        const createdList = tasksCreated || [];
        sections.push("", `## Tasks Created (${createdList.length})`);
        if (createdList.length === 0) {
          sections.push("", "No tasks created.");
        } else {
          sections.push("");
          for (const task of createdList) {
            const projectLabel = task.project_id && projectNameMap[task.project_id]
              ? ` [${projectNameMap[task.project_id]}]`
              : "";
            sections.push(`- ${task.content} (${task.status})${projectLabel} — ${formatDate(task.created_at)}`);
          }
        }

        // Tasks completed
        const completedList = tasksCompleted || [];
        sections.push("", `## Tasks Completed (${completedList.length})`);
        if (completedList.length === 0) {
          sections.push("", "No tasks completed.");
        } else {
          sections.push("");
          for (const task of completedList) {
            const projectLabel = task.project_id && projectNameMap[task.project_id]
              ? ` [${projectNameMap[task.project_id]}]`
              : "";
            sections.push(`- ${task.content}${projectLabel} — ${formatDate(task.updated_at)}`);
          }
        }

        // Projects
        sections.push("", `## Projects (${projectEntries.length})`);
        if (projectEntries.length === 0) {
          sections.push("", "No project activity.");
        } else {
          sections.push("");
          for (const entry of projectEntries) {
            sections.push(`- ${entry.name} (${entry.type || "—"}) — ${entry.action} ${formatDate(entry.date)}`);
          }
        }

        // AI outputs
        const outputList = aiOutputs || [];
        sections.push("", `## AI Outputs Delivered (${outputList.length})`);
        if (outputList.length === 0) {
          sections.push("", "No AI outputs delivered.");
        } else {
          sections.push("");
          for (const output of outputList) {
            sections.push(`- "${output.title}" → ${output.file_path} — ${formatDate(output.picked_up_at)}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: sections.join("\n") }],
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
