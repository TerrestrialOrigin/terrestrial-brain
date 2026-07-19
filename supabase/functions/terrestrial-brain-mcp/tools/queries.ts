import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { uuidField } from "../zod-schemas.ts";
import {
  MAX_RECENT_ACTIVITY_DAYS,
  RECENT_ACTIVITY_SECTION_LIMIT,
} from "../constants.ts";
import { withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import { renderSectionBody } from "./section-format.ts";
import { isTaskOverdue, taskStatusIcon } from "./tasks.ts";
import { buildUsefulnessReminder } from "./usefulness-reminder.ts";
import type { RepoError, RepoResult } from "../repositories/repo-result.ts";
import type {
  CreatedNamedRow,
  DeliveredAiOutputRow,
  ProjectSummaryReads,
  RecentActivityReads,
  RecentTaskCompletedRow,
  RecentTaskCreatedRow,
  RecentThoughtRow,
  SummaryChildRow,
  SummaryProjectRow,
  SummaryTaskRow,
  SummaryThoughtRow,
  UpdatedNamedRow,
} from "../repositories/query-repository.ts";
import type { ToolDeps } from "./tool-deps.ts";

/** Max thoughts shown in a project summary, most recent first. */
const MAX_PROJECT_THOUGHTS = 25;

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

/** One "name + type + action + date" activity row (created or updated). */
interface ActivityEntry {
  name: string;
  type: string | null;
  action: string;
  date: string | null;
}

/**
 * Merge "created" and "updated" rows into one action-tagged list, deduplicated
 * by name (an entity appearing in both keeps only its "created" entry — created
 * is added first and wins). Shared by the projects and people sections of
 * get_recent_activity, which previously carried two verbatim copies of this.
 */
function dedupeByName(
  created: CreatedNamedRow[] | null,
  updated: UpdatedNamedRow[] | null,
): ActivityEntry[] {
  const seen = new Set<string>();
  const entries: ActivityEntry[] = [];
  for (const row of created || []) {
    seen.add(row.name);
    entries.push({
      name: row.name,
      type: row.type,
      action: "created",
      date: row.created_at,
    });
  }
  for (const row of updated || []) {
    if (!seen.has(row.name)) {
      seen.add(row.name);
      entries.push({
        name: row.name,
        type: row.type,
        action: "updated",
        date: row.updated_at,
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// get_project_summary — fetch/format split
// ---------------------------------------------------------------------------

/** Everything formatProjectSummary needs — gathered by fetchProjectSummary. */
interface ProjectSummaryData {
  project: SummaryProjectRow;
  parentName: string | null;
  children: RepoResult<SummaryChildRow[]>;
  tasks: RepoResult<SummaryTaskRow[]>;
  personMap: Map<string, string>;
  matchingThoughts: SummaryThoughtRow[];
  thoughtsError: RepoError | null;
  snapshotMap: Record<string, { title: string | null; reference_id: string }>;
}

/**
 * Gather all data for a project summary. Returns `{ error }` when the project
 * itself is not found (the only hard-stop); every other sub-query's error is
 * carried through so the formatter can surface it as an "unavailable" section.
 */
async function fetchProjectSummary(
  queryRepository: ProjectSummaryReads,
  id: string,
): Promise<{ data: ProjectSummaryData } | { error: string }> {
  const { data: project, error: projectError } = await queryRepository
    .getProjectById(id);
  if (projectError || !project) {
    return {
      error: `Project not found: ${projectError?.message || "unknown"}`,
    };
  }

  let parentName: string | null = null;
  if (project.parent_id) {
    const { data: parent, error: parentError } = await queryRepository
      .getProjectName(project.parent_id);
    if (parentError) {
      console.error(
        `get_project_summary parent lookup failed: ${parentError.message}`,
      );
    }
    parentName = parent?.name || null;
  }

  const children = await queryRepository.listChildProjects(id);
  const tasks = await queryRepository.listOpenTasksForProject(id);

  // Query both metadata formats in parallel: new (projects array) and old
  // (project_id string). If either fails the thoughts view is incomplete —
  // surface it rather than silently showing a partial (or empty) list.
  const [
    { data: newFormatThoughts, error: newFormatThoughtsError },
    { data: oldFormatThoughts, error: oldFormatThoughtsError },
  ] = await Promise.all([
    queryRepository.listThoughtsForProjectNewFormat(id),
    queryRepository.listThoughtsForProjectOldFormat(id),
  ]);
  const thoughtsError = newFormatThoughtsError ?? oldFormatThoughtsError;

  // Merge and deduplicate by ID, then take the most recent by date
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
      new Date(thoughtB.created_at ?? 0).getTime() -
      new Date(thoughtA.created_at ?? 0).getTime()
    )
    .slice(0, MAX_PROJECT_THOUGHTS);

  const snapshotMap = await fetchSnapshotMap(queryRepository, matchingThoughts);
  const personMap = await fetchTaskPersonMap(queryRepository, tasks.data);

  return {
    data: {
      project,
      parentName,
      children,
      tasks,
      personMap,
      matchingThoughts,
      thoughtsError,
      snapshotMap,
    },
  };
}

/** Resolve source-note snapshots for the thoughts that carry a snapshot id. */
async function fetchSnapshotMap(
  queryRepository: ProjectSummaryReads,
  thoughts: SummaryThoughtRow[],
): Promise<Record<string, { title: string | null; reference_id: string }>> {
  const snapshotIds = [
    ...new Set(
      thoughts
        .filter((thought) => thought.note_snapshot_id)
        .map((thought) => thought.note_snapshot_id),
    ),
  ];
  if (snapshotIds.length === 0) return {};

  const { data: snapshots, error: snapshotsError } = await queryRepository
    .getNoteSnapshotsByIds(snapshotIds as string[]);
  if (snapshotsError) {
    console.error(
      `get_project_summary source-note lookup failed: ${snapshotsError.message}`,
    );
  }
  return Object.fromEntries(
    (snapshots || []).map((snapshot) => [
      snapshot.id,
      { title: snapshot.title, reference_id: snapshot.reference_id },
    ]),
  );
}

/** Resolve assigned-person names for the given tasks (shared batched resolver). */
async function fetchTaskPersonMap(
  queryRepository: ProjectSummaryReads,
  tasks: SummaryTaskRow[] | null,
): Promise<Map<string, string>> {
  const taskPersonIds = [
    ...new Set(
      (tasks || [])
        .filter((task) => task.assigned_to)
        .map((task) => task.assigned_to),
    ),
  ];
  return taskPersonIds.length > 0
    ? await queryRepository.personNamesByIds(taskPersonIds as string[])
    : new Map<string, string>();
}

/** Render a project summary from already-fetched data. Pure — no I/O. */
function formatProjectSummary(data: ProjectSummaryData): string {
  const {
    project,
    parentName,
    children,
    tasks,
    personMap,
    matchingThoughts,
    thoughtsError,
    snapshotMap,
  } = data;
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
  if (children.error || (children.data && children.data.length > 0)) {
    const childBody = renderSectionBody(
      children,
      "", // never reached: section is skipped entirely on success-empty above
      (rows) =>
        rows
          .map(
            (child) => `- ${child.name} (${child.type || "—"}) — ${child.id}`,
          )
          .join("\n"),
      "get_project_summary children",
    );
    const childCount = children.error ? "?" : (children.data?.length ?? 0);
    sections.push(
      ["", `## Child Projects (${childCount})`, "", childBody].join("\n"),
    );
  }

  // Open tasks
  const taskList = tasks.data || [];
  const openTasksBody = renderSectionBody(
    tasks,
    "No open tasks.",
    (rows) =>
      rows
        .map((task) => {
          // Shared status-icon + overdue logic (TOOL-8): a done task is never
          // marked OVERDUE, matching every other task renderer.
          const statusIcon = taskStatusIcon(task.status);
          const duePart = task.due_by
            ? ` — due ${formatDate(task.due_by)}${
              isTaskOverdue(task.due_by, task.status) ? " (OVERDUE)" : ""
            }`
            : "";
          const assigneePart =
            task.assigned_to && personMap.get(task.assigned_to)
              ? ` (${personMap.get(task.assigned_to)})`
              : "";
          return `- ${statusIcon} ${task.content}${assigneePart}${duePart}`;
        })
        .join("\n"),
    "get_project_summary open tasks",
  );
  sections.push(
    [
      "",
      `## Open Tasks (${tasks.error ? "?" : taskList.length})`,
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
      `## Recent Thoughts (${thoughtsError ? "?" : matchingThoughts.length})`,
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
    const thoughtIds = matchingThoughts.map((thought) => thought.id);
    sections.push(buildUsefulnessReminder(thoughtIds, "terse"));
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// get_recent_activity — fetch/format split
// ---------------------------------------------------------------------------

/** Everything formatRecentActivity needs — gathered by fetchRecentActivity. */
interface RecentActivityData {
  effectiveDays: number;
  thoughts: RepoResult<RecentThoughtRow[]>;
  tasksCreated: RepoResult<RecentTaskCreatedRow[]>;
  tasksCompleted: RepoResult<RecentTaskCompletedRow[]>;
  projectEntries: ActivityEntry[];
  projectsError: RepoError | null;
  peopleEntries: ActivityEntry[];
  peopleError: RepoError | null;
  aiOutputs: RepoResult<DeliveredAiOutputRow[]>;
  projectNameMap: Map<string, string>;
}

/** Gather all cross-table recent-activity data for the last `days` days. */
async function fetchRecentActivity(
  queryRepository: RecentActivityReads,
  days: number,
): Promise<RecentActivityData> {
  // Clamp both ends: a nonsensical or huge window is handled gracefully (not
  // rejected), and the upper bound stops a wide window defeating the per-section
  // caps by widening the `since` filter (TOOL-10).
  const effectiveDays = Math.min(MAX_RECENT_ACTIVITY_DAYS, Math.max(1, days));
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - effectiveDays);
  const sinceIso = sinceDate.toISOString();

  const thoughts = await queryRepository.listRecentThoughts(sinceIso);
  const tasksCreated = await queryRepository.listTasksCreatedSince(sinceIso);
  const tasksCompleted = await queryRepository.listTasksCompletedSince(
    sinceIso,
  );

  const { data: projectsCreated, error: projectsCreatedError } =
    await queryRepository.listProjectsCreatedSince(sinceIso);
  const { data: projectsUpdated, error: projectsUpdatedError } =
    await queryRepository.listProjectsUpdatedSince(sinceIso);
  const projectsError = projectsCreatedError ?? projectsUpdatedError;
  const projectEntries = dedupeByName(projectsCreated, projectsUpdated);

  const aiOutputs = await queryRepository.listDeliveredAiOutputsSince(sinceIso);

  const { data: peopleCreated, error: peopleCreatedError } =
    await queryRepository
      .listPeopleCreatedSince(sinceIso);
  const { data: peopleUpdated, error: peopleUpdatedError } =
    await queryRepository
      .listPeopleUpdatedSince(sinceIso);
  const peopleError = peopleCreatedError ?? peopleUpdatedError;
  const peopleEntries = dedupeByName(peopleCreated, peopleUpdated);

  // Collect task project IDs for name resolution
  const projectIdSet = new Set<string>();
  for (const task of tasksCreated.data || []) {
    if (task.project_id) projectIdSet.add(task.project_id);
  }
  for (const task of tasksCompleted.data || []) {
    if (task.project_id) projectIdSet.add(task.project_id);
  }
  const projectNameMap = projectIdSet.size > 0
    ? await queryRepository.projectNamesByIds([...projectIdSet])
    : new Map<string, string>();

  return {
    effectiveDays,
    thoughts,
    tasksCreated,
    tasksCompleted,
    projectEntries,
    projectsError,
    peopleEntries,
    peopleError,
    aiOutputs,
    projectNameMap,
  };
}

/** Render recent activity from already-fetched data. Pure — no I/O. */
function formatRecentActivity(data: RecentActivityData): string {
  const {
    effectiveDays,
    thoughts,
    tasksCreated,
    tasksCompleted,
    projectEntries,
    projectsError,
    peopleEntries,
    peopleError,
    aiOutputs,
    projectNameMap,
  } = data;

  const sections: string[] = [];
  sections.push(
    `# Activity — Last ${effectiveDays} Day${effectiveDays !== 1 ? "s" : ""}`,
  );

  // Push one "## Header (count)" section, surfacing a failed query as an
  // explicit unavailable marker rather than empty-state prose (finding C9).
  // Each section is bounded at RECENT_ACTIVITY_SECTION_LIMIT: past the cap the
  // rows are sliced and the count shows a `(50+)` truncation marker so a cut is
  // never silent (the repositories fetch `limit + 1` to signal "more exist").
  const pushSection = <Row>(
    title: string,
    result: { data: Row[] | null; error: { message: string } | null },
    emptyText: string,
    renderRows: (rows: Row[]) => string,
    context: string,
  ) => {
    let count: string;
    let shownResult = result;
    if (result.error) {
      count = "?";
    } else {
      const all = result.data ?? [];
      const truncated = all.length > RECENT_ACTIVITY_SECTION_LIMIT;
      const shown = truncated
        ? all.slice(0, RECENT_ACTIVITY_SECTION_LIMIT)
        : all;
      count = truncated ? `${RECENT_ACTIVITY_SECTION_LIMIT}+` : `${all.length}`;
      shownResult = { data: shown, error: null };
    }
    sections.push(
      "",
      `## ${title} (${count})`,
      "",
      renderSectionBody(shownResult, emptyText, renderRows, context),
    );
  };

  // Thoughts
  const thoughtList = thoughts.data || [];
  pushSection(
    "Thoughts",
    { data: thoughts.error ? null : thoughtList, error: thoughts.error },
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
    tasksCreated,
    "No tasks created.",
    (rows) =>
      rows
        .map((task) => {
          const projectLabel = task.project_id &&
              projectNameMap.get(task.project_id)
            ? ` [${projectNameMap.get(task.project_id)}]`
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
    tasksCompleted,
    "No tasks completed.",
    (rows) =>
      rows
        .map((task) => {
          const projectLabel = task.project_id &&
              projectNameMap.get(task.project_id)
            ? ` [${projectNameMap.get(task.project_id)}]`
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
    aiOutputs,
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
    const thoughtIds = thoughtList.map((thought) => thought.id);
    sections.push(buildUsefulnessReminder(thoughtIds, "terse"));
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function register(
  server: McpServer,
  deps: Pick<ToolDeps, "logger" | "queryRepository">,
) {
  const { logger, queryRepository } = deps;
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
        id: uuidField().describe("Project UUID"),
      },
    },
    withMcpLogging("get_project_summary", async ({ id }) => {
      const result = await fetchProjectSummary(queryRepository, id);
      if ("error" in result) {
        return errorResult(result.error);
      }
      return textResult(formatProjectSummary(result.data));
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
        // `days` is clamped inside the handler (negative/zero → 1); kept as a
        // plain number so that graceful-clamping contract is preserved rather
        // than rejecting out-of-range input. Finding 7.3 scopes the
        // bounded-input requirement to `limit`, not this window param.
        days: z.number().optional().default(7).describe(
          `Number of days to look back (clamped to 1–${MAX_RECENT_ACTIVITY_DAYS}, default 7)`,
        ),
      },
    },
    withMcpLogging("get_recent_activity", async ({ days }) => {
      const data = await fetchRecentActivity(queryRepository, days);
      return textResult(formatRecentActivity(data));
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
        id: uuidField().optional().describe(
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

      const { data: snapshot, error } = id
        ? await queryRepository.getNoteSnapshotById(id)
        : await queryRepository.getNoteSnapshotByReference(reference_id!);

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

// Exported for unit testing the pure formatters + dedup helper.
export {
  dedupeByName,
  fetchProjectSummary,
  fetchRecentActivity,
  formatProjectSummary,
  formatRecentActivity,
};
export type { ProjectSummaryData, RecentActivityData };
