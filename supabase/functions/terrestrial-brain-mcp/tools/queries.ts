import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import { renderSectionBody } from "./section-format.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export function register(
  server: McpServer,
  supabase: SupabaseClient,
  logger: FunctionCallLogger,
) {
  // ─── get_project_summary ─────────────────────────────────────────────────

  server.registerTool(
    "get_project_summary",
    {
      title: "Get Project Summary",
      description:
        "Get a comprehensive summary of a project in a single call: project details (name, type, description), child projects, " +
        "all open tasks (with assigned person names), the 25 most recent thoughts referencing this project, and a list of " +
        "referenced Obsidian source notes (titles and reference IDs only — not the note bodies). " +
        "This is the best starting point when the user asks about a specific project — it gives you the full picture " +
        "so you can answer follow-up questions without additional calls. Prefer this over get_project for richer context.",
      inputSchema: {
        id: z.string().describe("Project UUID"),
      },
    },
    withMcpLogging("get_project_summary", async ({ id }) => {
      // 1. Fetch project
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();

      if (projectError || !project) {
        return errorResult(
          `Project not found: ${projectError?.message || "unknown"}`,
        );
      }

      // 2. Fetch parent name
      let parentName: string | null = null;
      if (project.parent_id) {
        const { data: parent, error: parentError } = await supabase
          .from("projects")
          .select("name")
          .eq("id", project.parent_id)
          .single();
        if (parentError) {
          console.error(
            `get_project_summary parent lookup failed: ${parentError.message}`,
          );
        }
        parentName = parent?.name || null;
      }

      // 3. Fetch children
      const { data: children, error: childrenError } = await supabase
        .from("projects")
        .select("id, name, type")
        .eq("parent_id", id)
        .is("archived_at", null)
        .order("name");

      // 4. Fetch open tasks
      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select("id, content, status, due_by, assigned_to, created_at")
        .eq("project_id", id)
        .is("archived_at", null)
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false });

      // 5. Fetch recent thoughts that reference this project (DB-side filtering)
      // Query both metadata formats in parallel: new (projects array) and old (project_id string)
      const [
        { data: newFormatThoughts, error: newFormatThoughtsError },
        { data: oldFormatThoughts, error: oldFormatThoughtsError },
      ] = await Promise.all([
        supabase
          .from("thoughts")
          .select("id, content, metadata, note_snapshot_id, created_at")
          .contains("metadata", { references: { projects: [id] } })
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(25),
        supabase
          .from("thoughts")
          .select("id, content, metadata, note_snapshot_id, created_at")
          .contains("metadata", { references: { project_id: id } })
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(25),
      ]);
      // If either format query fails the thoughts view is incomplete — surface it
      // rather than silently showing a partial (or empty) list.
      const thoughtsError = newFormatThoughtsError ?? oldFormatThoughtsError;

      // Merge and deduplicate by ID, then take top 10 by date
      const allProjectThoughts = [
        ...(newFormatThoughts || []),
        ...(oldFormatThoughts || []),
      ];
      const seenThoughtIds = new Set<string>();
      const matchingThoughts = allProjectThoughts
        .filter((thought) => {
          if (seenThoughtIds.has(thought.id)) return false;
          seenThoughtIds.add(thought.id);
          return true;
        })
        .sort((thoughtA, thoughtB) =>
          new Date(thoughtB.created_at).getTime() -
          new Date(thoughtA.created_at).getTime()
        )
        .slice(0, 25);

      // 6. Fetch source note snapshots for matching thoughts
      const snapshotIds = [
        ...new Set(
          matchingThoughts
            .filter((thought: { note_snapshot_id: string | null }) =>
              thought.note_snapshot_id
            )
            .map((thought: { note_snapshot_id: string }) =>
              thought.note_snapshot_id
            ),
        ),
      ];

      let snapshotMap: Record<
        string,
        { title: string | null; reference_id: string }
      > = {};
      if (snapshotIds.length > 0) {
        const { data: snapshots, error: snapshotsError } = await supabase
          .from("note_snapshots")
          .select("id, title, reference_id")
          .in("id", snapshotIds);

        if (snapshotsError) {
          console.error(
            `get_project_summary source-note lookup failed: ${snapshotsError.message}`,
          );
        }
        snapshotMap = Object.fromEntries(
          (snapshots || []).map((
            snapshot: {
              id: string;
              title: string | null;
              reference_id: string;
            },
          ) => [
            snapshot.id,
            { title: snapshot.title, reference_id: snapshot.reference_id },
          ]),
        );
      }

      // 6b. Resolve assigned person names for tasks
      const taskPersonIds = [
        ...new Set(
          (tasks || [])
            .filter((task: { assigned_to: string | null }) => task.assigned_to)
            .map((task: { assigned_to: string }) => task.assigned_to),
        ),
      ];
      let personMap: Record<string, string> = {};
      if (taskPersonIds.length > 0) {
        const { data: people, error: peopleError } = await supabase
          .from("people")
          .select("id, name")
          .in("id", taskPersonIds);
        if (peopleError) {
          console.error(
            `get_project_summary assignee lookup failed: ${peopleError.message}`,
          );
        }
        personMap = Object.fromEntries(
          (people || []).map((
            person: { id: string; name: string },
          ) => [person.id, person.name]),
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
        `**Updated:** ${formatDate(project.updated_at)}`,
      );
      sections.push(detailLines.join("\n"));

      // Children — only render a section when there are children OR the lookup
      // failed (a failure must not be indistinguishable from "no children").
      if (childrenError || (children && children.length > 0)) {
        const childBody = renderSectionBody(
          { data: children, error: childrenError },
          "", // never reached: section is skipped entirely on success-empty above
          (rows) =>
            rows
              .map(
                (child: { name: string; type: string | null; id: string }) =>
                  `- ${child.name} (${child.type || "—"}) — ${child.id}`,
              )
              .join("\n"),
          "get_project_summary children",
        );
        const childCount = childrenError ? "?" : (children?.length ?? 0);
        sections.push(
          ["", `## Child Projects (${childCount})`, "", childBody].join("\n"),
        );
      }

      // Open tasks
      const taskList = tasks || [];
      const openTasksBody = renderSectionBody(
        { data: tasks, error: tasksError },
        "No open tasks.",
        (rows) =>
          rows
            .map((task) => {
              const statusIcon = task.status === "in_progress" ? "[~]" : "[ ]";
              const duePart = task.due_by
                ? ` — due ${formatDate(task.due_by)}${
                  new Date(task.due_by) < new Date() ? " (OVERDUE)" : ""
                }`
                : "";
              const assigneePart =
                task.assigned_to && personMap[task.assigned_to]
                  ? ` (${personMap[task.assigned_to]})`
                  : "";
              return `- ${statusIcon} ${task.content}${assigneePart}${duePart}`;
            })
            .join("\n"),
        "get_project_summary open tasks",
      );
      sections.push(
        [
          "",
          `## Open Tasks (${tasksError ? "?" : taskList.length})`,
          "",
          openTasksBody,
        ].join("\n"),
      );

      // Recent thoughts
      const thoughtsBody = renderSectionBody(
        { data: thoughtsError ? null : matchingThoughts, error: thoughtsError },
        "No recent thoughts referencing this project.",
        (rows) =>
          rows
            .map((thought) => {
              const meta = (thought.metadata || {}) as Record<string, unknown>;
              const typeLabel = (meta.type as string) || "unknown";
              return `- [${
                formatDate(thought.created_at)
              }] (${typeLabel}) ID: ${thought.id}\n  ${thought.content}`;
            })
            .join("\n"),
        "get_project_summary recent thoughts",
      );
      sections.push(
        [
          "",
          `## Recent Thoughts (${
            thoughtsError ? "?" : matchingThoughts.length
          })`,
          "",
          thoughtsBody,
        ].join("\n"),
      );

      // Source notes
      const uniqueSnapshots = Object.values(snapshotMap);
      if (uniqueSnapshots.length > 0) {
        const noteLines = [
          "",
          `## Source Notes (${uniqueSnapshots.length})`,
          "",
          ...uniqueSnapshots.map(
            (snapshot) =>
              `- ${
                snapshot.title || snapshot.reference_id
              } (${snapshot.reference_id})`,
          ),
        ];
        sections.push(noteLines.join("\n"));
      }

      // Usefulness reminder
      if (matchingThoughts.length > 0) {
        const thoughtIds = matchingThoughts.map((thought: { id: string }) =>
          thought.id
        );
        sections.push(
          `\n---\nReminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs: ${
            JSON.stringify(thoughtIds)
          }`,
        );
      }

      return textResult(sections.join("\n"));
    }, logger),
  );

  // ─── get_recent_activity ─────────────────────────────────────────────────

  server.registerTool(
    "get_recent_activity",
    {
      title: "Get Recent Activity",
      description:
        "Get a cross-table summary of recent activity across the entire knowledge base: new thoughts captured, tasks created, " +
        "tasks completed, project updates, people added or updated, and AI outputs delivered. " +
        "Use this as a conversation opener when the user asks 'what's been going on?', 'catch me up', or 'what happened this week?'. " +
        "Also useful for your own orientation at the start of a session to understand the user's recent context.",
      inputSchema: {
        days: z.number().optional().default(7).describe(
          "Number of days to look back (default 7)",
        ),
      },
    },
    withMcpLogging("get_recent_activity", async ({ days }) => {
      const effectiveDays = Math.max(1, days);
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - effectiveDays);
      const sinceIso = sinceDate.toISOString();

      // 1. Recent thoughts
      const { data: thoughts, error: thoughtsError } = await supabase
        .from("thoughts")
        .select("id, content, metadata, created_at")
        .is("archived_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(20);

      // 2. Tasks created
      const { data: tasksCreated, error: tasksCreatedError } = await supabase
        .from("tasks")
        .select("content, status, project_id, created_at")
        .is("archived_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false });

      // 3. Tasks completed (done + updated recently)
      const { data: tasksCompleted, error: tasksCompletedError } =
        await supabase
          .from("tasks")
          .select("content, project_id, updated_at")
          .eq("status", "done")
          .is("archived_at", null)
          .gte("updated_at", sinceIso)
          .order("updated_at", { ascending: false });

      // 4. Projects created or updated
      const { data: projectsCreated, error: projectsCreatedError } =
        await supabase
          .from("projects")
          .select("name, type, created_at")
          .is("archived_at", null)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false });

      const { data: projectsUpdated, error: projectsUpdatedError } =
        await supabase
          .from("projects")
          .select("name, type, updated_at")
          .is("archived_at", null)
          .gte("updated_at", sinceIso)
          .order("updated_at", { ascending: false });
      const projectsError = projectsCreatedError ?? projectsUpdatedError;

      // Deduplicate projects (could appear in both created and updated)
      const allProjectNames = new Set<string>();
      const projectEntries: {
        name: string;
        type: string | null;
        action: string;
        date: string;
      }[] = [];

      for (const project of projectsCreated || []) {
        allProjectNames.add(project.name);
        projectEntries.push({
          name: project.name,
          type: project.type,
          action: "created",
          date: project.created_at,
        });
      }
      for (const project of projectsUpdated || []) {
        if (!allProjectNames.has(project.name)) {
          allProjectNames.add(project.name);
          projectEntries.push({
            name: project.name,
            type: project.type,
            action: "updated",
            date: project.updated_at,
          });
        }
      }

      // 5. AI outputs delivered
      const { data: aiOutputs, error: aiOutputsError } = await supabase
        .from("ai_output")
        .select("title, file_path, picked_up_at")
        .eq("picked_up", true)
        .gte("picked_up_at", sinceIso)
        .order("picked_up_at", { ascending: false });

      // 6. People created or updated
      const { data: peopleCreated, error: peopleCreatedError } = await supabase
        .from("people")
        .select("name, type, created_at")
        .is("archived_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false });

      const { data: peopleUpdated, error: peopleUpdatedError } = await supabase
        .from("people")
        .select("name, type, updated_at")
        .is("archived_at", null)
        .gte("updated_at", sinceIso)
        .order("updated_at", { ascending: false });
      const peopleError = peopleCreatedError ?? peopleUpdatedError;

      // Deduplicate people (could appear in both created and updated)
      const allPeopleNames = new Set<string>();
      const peopleEntries: {
        name: string;
        type: string | null;
        action: string;
        date: string;
      }[] = [];

      for (const person of peopleCreated || []) {
        allPeopleNames.add(person.name);
        peopleEntries.push({
          name: person.name,
          type: person.type,
          action: "created",
          date: person.created_at,
        });
      }
      for (const person of peopleUpdated || []) {
        if (!allPeopleNames.has(person.name)) {
          allPeopleNames.add(person.name);
          peopleEntries.push({
            name: person.name,
            type: person.type,
            action: "updated",
            date: person.updated_at,
          });
        }
      }

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
        const { data: projects, error: projectNamesError } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", [...projectIdSet]);
        if (projectNamesError) {
          console.error(
            `get_recent_activity project-name lookup failed: ${projectNamesError.message}`,
          );
        }
        projectNameMap = Object.fromEntries(
          (projects || []).map((
            project: { id: string; name: string },
          ) => [project.id, project.name]),
        );
      }

      // ─── Format output ───────────────────────────────────────────────────

      const sections: string[] = [];
      sections.push(
        `# Activity — Last ${effectiveDays} Day${
          effectiveDays !== 1 ? "s" : ""
        }`,
      );

      // Push one "## Header (count)" section, surfacing a failed query as an
      // explicit unavailable marker rather than empty-state prose (finding C9).
      const pushSection = <Row>(
        title: string,
        result: { data: Row[] | null; error: { message: string } | null },
        emptyText: string,
        renderRows: (rows: Row[]) => string,
        context: string,
      ) => {
        const count = result.error ? "?" : (result.data?.length ?? 0);
        sections.push(
          "",
          `## ${title} (${count})`,
          "",
          renderSectionBody(result, emptyText, renderRows, context),
        );
      };

      // Thoughts
      const thoughtList = thoughts || [];
      pushSection(
        "Thoughts",
        { data: thoughtsError ? null : thoughtList, error: thoughtsError },
        "No new thoughts.",
        (rows) =>
          rows
            .map((thought) => {
              const meta = (thought.metadata || {}) as Record<string, unknown>;
              const typeLabel = (meta.type as string) || "unknown";
              return `- [${
                formatDate(thought.created_at)
              }] (${typeLabel}) ID: ${thought.id}\n  ${thought.content}`;
            })
            .join("\n"),
        "get_recent_activity thoughts",
      );

      // Tasks created
      pushSection(
        "Tasks Created",
        { data: tasksCreated, error: tasksCreatedError },
        "No tasks created.",
        (rows) =>
          rows
            .map((task) => {
              const projectLabel =
                task.project_id && projectNameMap[task.project_id]
                  ? ` [${projectNameMap[task.project_id]}]`
                  : "";
              return `- ${task.content} (${task.status})${projectLabel} — ${
                formatDate(task.created_at)
              }`;
            })
            .join("\n"),
        "get_recent_activity tasks created",
      );

      // Tasks completed
      pushSection(
        "Tasks Completed",
        { data: tasksCompleted, error: tasksCompletedError },
        "No tasks completed.",
        (rows) =>
          rows
            .map((task) => {
              const projectLabel =
                task.project_id && projectNameMap[task.project_id]
                  ? ` [${projectNameMap[task.project_id]}]`
                  : "";
              return `- ${task.content}${projectLabel} — ${
                formatDate(task.updated_at)
              }`;
            })
            .join("\n"),
        "get_recent_activity tasks completed",
      );

      // Projects
      pushSection(
        "Projects",
        { data: projectsError ? null : projectEntries, error: projectsError },
        "No project activity.",
        (rows) =>
          rows
            .map((entry) =>
              `- ${entry.name} (${entry.type || "—"}) — ${entry.action} ${
                formatDate(entry.date)
              }`
            )
            .join("\n"),
        "get_recent_activity projects",
      );

      // People
      pushSection(
        "People",
        { data: peopleError ? null : peopleEntries, error: peopleError },
        "No people activity.",
        (rows) =>
          rows
            .map((entry) =>
              `- ${entry.name} (${entry.type || "—"}) — ${entry.action} ${
                formatDate(entry.date)
              }`
            )
            .join("\n"),
        "get_recent_activity people",
      );

      // AI outputs
      pushSection(
        "AI Outputs Delivered",
        { data: aiOutputs, error: aiOutputsError },
        "No AI outputs delivered.",
        (rows) =>
          rows
            .map((output) =>
              `- "${output.title}" → ${output.file_path} — ${
                formatDate(output.picked_up_at)
              }`
            )
            .join("\n"),
        "get_recent_activity ai outputs",
      );

      // Usefulness reminder
      if (thoughtList.length > 0) {
        const thoughtIds = thoughtList.map((thought: { id: string }) =>
          thought.id
        );
        sections.push(
          `\n---\nReminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs: ${
            JSON.stringify(thoughtIds)
          }`,
        );
      }

      return textResult(sections.join("\n"));
    }, logger),
  );

  // ─── get_note_snapshot ───────────────────────────────────────────────────

  server.registerTool(
    "get_note_snapshot",
    {
      title: "Get Note Snapshot",
      description:
        "Fetch the full body of an Obsidian source note by snapshot id or reference_id. " +
        "USE SPARINGLY. The thought's own `content` is almost always sufficient — prefer it. " +
        "Only call this tool when you genuinely need the surrounding note context, for example: " +
        "(a) the thought content is ambiguous, truncated, or does not make sense on its own, or " +
        "(b) the user explicitly asks to see the original note, or " +
        "(c) answering the user's question provably requires material that is not in the thought. " +
        "Do NOT call this routinely, in bulk, or 'just in case' — note bodies are long and pollute the context window. " +
        "If `get_project_summary` or a thought record already answers the question, stop there.",
      inputSchema: {
        id: z.string().optional().describe(
          "Snapshot UUID (preferred when known, e.g. from a thought's note_snapshot_id)",
        ),
        reference_id: z.string().optional().describe(
          "Obsidian reference_id (e.g. vault-relative path), used when the UUID is not known",
        ),
      },
    },
    withMcpLogging("get_note_snapshot", async ({ id, reference_id }) => {
      if (!id && !reference_id) {
        return errorResult("Must provide either `id` or `reference_id`.");
      }

      let query = supabase
        .from("note_snapshots")
        .select("id, reference_id, title, content, source, captured_at");

      query = id ? query.eq("id", id) : query.eq("reference_id", reference_id!);

      const { data: snapshot, error } = await query.single();

      if (error || !snapshot) {
        return errorResult(
          `Note snapshot not found: ${error?.message || "unknown"}`,
        );
      }

      const header = [
        `# ${snapshot.title || snapshot.reference_id}`,
        "",
        `**Reference ID:** ${snapshot.reference_id}`,
        `**Source:** ${snapshot.source || "—"}`,
        `**Captured:** ${formatDate(snapshot.captured_at)}`,
        `**Snapshot ID:** ${snapshot.id}`,
        "",
        "---",
        "",
        snapshot.content,
      ].join("\n");

      return textResult(header);
    }, logger),
  );
}
