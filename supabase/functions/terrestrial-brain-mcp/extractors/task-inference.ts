/**
 * Task LLM inference — the TaskExtractor's two batched LLM calls (split from
 * task-extractor.ts, EXTR-12): project inference by content, and combined
 * due-date + person enrichment. Prompt scaffolding (entity lists, id
 * allowlists, fallback frame) comes from the shared llm-helpers (EXTR-13).
 */

import type { KnownProject } from "./pipeline.ts";
import { isRecord } from "./pipeline.ts";
import type { KnownPerson } from "./name-matching.ts";
import { getZonedDate } from "./date-parser.ts";
import type { AiProvider } from "../ai/ai-provider.ts";
import {
  buildIdAllowlist,
  callJsonWithFallback,
  formatEntityList,
} from "./llm-helpers.ts";

// ---------------------------------------------------------------------------
// Project inference
// ---------------------------------------------------------------------------

export interface TaskProjectAssignment {
  taskIndex: number;
  projectId: string;
}

export async function inferProjectsByContent(
  taskTexts: { index: number; text: string }[],
  knownProjects: KnownProject[],
  aiProvider: AiProvider,
): Promise<{ ok: boolean; assignments: TaskProjectAssignment[] }> {
  if (taskTexts.length === 0 || knownProjects.length === 0) {
    return { ok: true, assignments: [] };
  }

  const projectList = formatEntityList(knownProjects);
  const taskList = taskTexts
    .map((task) => `${task.index}: "${task.text}"`)
    .join("\n");
  const validIds = buildIdAllowlist(knownProjects);

  // A transport/parse failure returns { ok: false } so the caller keeps existing
  // project assignments untouched; a well-formed-but-empty response is { ok: true }.
  return await callJsonWithFallback<
    { ok: boolean; assignments: TaskProjectAssignment[] }
  >({
    aiProvider,
    request: {
      purpose: "assign-task-projects",
      systemPrompt:
        `You match tasks to projects. Given a list of tasks and known projects, return which project each task belongs to. Only use project IDs from the list. If a task doesn't clearly belong to any project, omit it.

Return JSON: {"assignments": [{"task_index": 0, "project_id": "uuid"}, ...]}

KNOWN PROJECTS:
${projectList}`,
      userContent: `TASKS:\n${taskList}`,
    },
    parse: (raw): { ok: true; assignments: TaskProjectAssignment[] } => {
      const parsed: { assignments?: unknown } = isRecord(raw) ? raw : {};
      if (!Array.isArray(parsed.assignments)) {
        return { ok: true, assignments: [] };
      }
      // One malformed element is skipped, never allowed to throw and drop
      // the whole batch (EXTR-8).
      const assignments = parsed.assignments
        .filter(
          (assignment): assignment is {
            task_index: number;
            project_id: string;
          } =>
            isRecord(assignment) &&
            typeof assignment.task_index === "number" &&
            typeof assignment.project_id === "string" &&
            validIds.has(assignment.project_id),
        )
        .map((assignment) => ({
          taskIndex: assignment.task_index,
          projectId: assignment.project_id,
        }));
      return { ok: true, assignments };
    },
    fallback: { ok: false, assignments: [] },
    label: "TaskExtractor LLM project inference error",
  });
}

// ---------------------------------------------------------------------------
// AI enrichment: combined date + person extraction for unresolved tasks
// ---------------------------------------------------------------------------

export interface TaskEnrichment {
  taskIndex: number;
  assignedToId: string | null;
  dueDate: string | null;
  cleanedText: string;
}

/**
 * Single batch LLM call that extracts both due dates and person assignment
 * from task text + context. Handles implicit patterns like:
 * - "# Matt's tasks" → assigned to Matt
 * - "finish by end of month" → due date
 * - "Bob should review this" → assigned to Bob
 */
export async function inferTaskEnrichments(
  tasks: { index: number; text: string; sectionHeading: string | null }[],
  knownPeople: KnownPerson[],
  aiProvider: AiProvider,
  referenceDate: Date = new Date(),
  timeZone: string = "UTC",
): Promise<{ ok: boolean; enrichments: TaskEnrichment[] }> {
  if (tasks.length === 0) return { ok: true, enrichments: [] };

  // Reference "today" for the LLM must be the user-zone calendar date, matching
  // the regex path — otherwise the model resolves relatives off the UTC day.
  const today = getZonedDate(referenceDate, timeZone);
  const referenceDateStr = `${today.year}-${
    String(today.month + 1).padStart(2, "0")
  }-${String(today.day).padStart(2, "0")}`;

  const peopleList = knownPeople.length > 0
    ? formatEntityList(knownPeople)
    : "(no known people)";

  const validPeopleIds = buildIdAllowlist(knownPeople);

  const taskList = tasks
    .map((task) => {
      const heading = task.sectionHeading
        ? ` [under heading: "${task.sectionHeading}"]`
        : "";
      return `${task.index}: "${task.text}"${heading}`;
    })
    .join("\n");

  // A transport/parse failure returns { ok: false } so the caller falls back to
  // the regex-derived dates/assignments; a well-formed-but-empty response is ok.
  return await callJsonWithFallback<
    { ok: boolean; enrichments: TaskEnrichment[] }
  >({
    aiProvider,
    request: {
      purpose: "enrich-tasks",
      systemPrompt:
        `You extract metadata from task descriptions. Today is ${referenceDateStr}.

For each task, determine:
1. **assigned_to_id**: Who is this task assigned to? Look for:
   - Explicit markers: "(assigned: X)", "(owner: X)"
   - Names in the task text: "Ask Alice about..."
   - Section heading context: heading "Matt's tasks" means tasks under it are Matt's
   - Only use person IDs from the KNOWN PEOPLE list. If no match, use null.

2. **due_date**: When is this task due? Look for:
   - Explicit dates: "by March 30", "deadline: April 1st", "2026-04-01"
   - Relative dates: "by Friday", "tomorrow", "next week", "end of month"
   - Resolve relative dates from today (${referenceDateStr}). Return ISO format.
   - If no date found, use null.

3. **cleaned_text**: The task description with assignment markers and date markers REMOVED. Keep the core task description intact. Remove patterns like "(assigned: X)", "(owner: X)", "(deadline: Y)", "by DATE", "due DATE" etc.

Return JSON: {"enrichments": [{"task_index": 0, "assigned_to_id": "uuid"|null, "due_date": "2026-04-01T00:00:00.000Z"|null, "cleaned_text": "task without markers"}]}

KNOWN PEOPLE:
${peopleList}`,
      userContent: `TASKS:\n${taskList}`,
    },
    parse: (raw): { ok: true; enrichments: TaskEnrichment[] } => {
      const parsed: { enrichments?: unknown } = isRecord(raw) ? raw : {};
      if (!Array.isArray(parsed.enrichments)) {
        return { ok: true, enrichments: [] };
      }
      // One malformed element is skipped, never allowed to throw and drop
      // the whole batch (EXTR-8).
      const enrichments = parsed.enrichments
        .filter(
          (entry): entry is {
            task_index: number;
            assigned_to_id?: string | null;
            due_date?: string | null;
            cleaned_text: string;
          } =>
            isRecord(entry) &&
            typeof entry.task_index === "number" &&
            typeof entry.cleaned_text === "string",
        )
        .map((
          entry,
        ) => ({
          taskIndex: entry.task_index,
          assignedToId: typeof entry.assigned_to_id === "string" &&
              validPeopleIds.has(entry.assigned_to_id)
            ? entry.assigned_to_id
            : null,
          dueDate: typeof entry.due_date === "string" &&
              !isNaN(new Date(entry.due_date).getTime())
            ? new Date(entry.due_date).toISOString()
            : null,
          cleanedText: entry.cleaned_text,
        }));
      return { ok: true, enrichments };
    },
    fallback: { ok: false, enrichments: [] },
    label: "Task enrichment LLM error",
  });
}
