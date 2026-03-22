/**
 * TaskExtractor — detects tasks from note checkboxes.
 *
 * Converts ParsedCheckbox[] into task rows with:
 * - Project association via priority chain (section heading > file path > AI inference)
 * - Subtask hierarchy from indentation (parent_id)
 * - Reconciliation against existing tasks on re-ingest
 */

import type { ParsedNote, ParsedCheckbox } from "../parser.ts";
import type {
  ExtractionContext,
  ExtractionResult,
  Extractor,
} from "./pipeline.ts";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

// ---------------------------------------------------------------------------
// Content similarity
// ---------------------------------------------------------------------------

/**
 * Normalizes text for comparison: lowercase, collapse whitespace, trim.
 */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Computes similarity ratio between two strings (0..1).
 * Uses longest common subsequence length / max length.
 */
export function computeSimilarity(textA: string, textB: string): number {
  const normalizedA = normalizeText(textA);
  const normalizedB = normalizeText(textB);

  if (normalizedA === normalizedB) return 1.0;
  if (normalizedA.length === 0 || normalizedB.length === 0) return 0.0;

  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  const lcsLength = longestCommonSubsequenceLength(normalizedA, normalizedB);

  return lcsLength / maxLength;
}

/**
 * Returns the length of the longest common subsequence of two strings.
 * O(m*n) time and space — fine for short checkbox text.
 */
function longestCommonSubsequenceLength(
  textA: string,
  textB: string,
): number {
  const lengthA = textA.length;
  const lengthB = textB.length;

  // Use two rows to reduce memory
  let previousRow = new Array(lengthB + 1).fill(0);
  let currentRow = new Array(lengthB + 1).fill(0);

  for (let indexA = 1; indexA <= lengthA; indexA++) {
    for (let indexB = 1; indexB <= lengthB; indexB++) {
      if (textA[indexA - 1] === textB[indexB - 1]) {
        currentRow[indexB] = previousRow[indexB - 1] + 1;
      } else {
        currentRow[indexB] = Math.max(
          previousRow[indexB],
          currentRow[indexB - 1],
        );
      }
    }
    [previousRow, currentRow] = [currentRow, previousRow];
    currentRow.fill(0);
  }

  return previousRow[lengthB];
}

const SIMILARITY_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Task reconciliation
// ---------------------------------------------------------------------------

interface TaskMatch {
  existingTaskId: string;
  checkboxIndex: number;
  similarity: number;
}

/**
 * Matches checkboxes against known tasks by content similarity.
 * Returns matched pairs and unmatched checkbox indices.
 */
function reconcileCheckboxes(
  checkboxes: ParsedCheckbox[],
  knownTasks: { id: string; content: string; reference_id: string | null }[],
): {
  matched: TaskMatch[];
  unmatchedCheckboxIndices: number[];
  unmatchedTaskIds: string[];
} {
  if (knownTasks.length === 0) {
    return {
      matched: [],
      unmatchedCheckboxIndices: checkboxes.map((_, index) => index),
      unmatchedTaskIds: [],
    };
  }

  // Build similarity matrix
  const candidates: TaskMatch[] = [];
  for (let checkboxIndex = 0; checkboxIndex < checkboxes.length; checkboxIndex++) {
    for (const task of knownTasks) {
      const similarity = computeSimilarity(
        checkboxes[checkboxIndex].text,
        task.content,
      );
      if (similarity >= SIMILARITY_THRESHOLD) {
        candidates.push({
          existingTaskId: task.id,
          checkboxIndex,
          similarity,
        });
      }
    }
  }

  // Greedy match: sort by similarity desc, then assign 1:1
  candidates.sort((candidateA, candidateB) => candidateB.similarity - candidateA.similarity);

  const matchedCheckboxIndices = new Set<number>();
  const matchedTaskIds = new Set<string>();
  const matched: TaskMatch[] = [];

  for (const candidate of candidates) {
    if (
      matchedCheckboxIndices.has(candidate.checkboxIndex) ||
      matchedTaskIds.has(candidate.existingTaskId)
    ) {
      continue;
    }
    matched.push(candidate);
    matchedCheckboxIndices.add(candidate.checkboxIndex);
    matchedTaskIds.add(candidate.existingTaskId);
  }

  const unmatchedCheckboxIndices = checkboxes
    .map((_, index) => index)
    .filter((index) => !matchedCheckboxIndices.has(index));

  const unmatchedTaskIds = knownTasks
    .map((task) => task.id)
    .filter((taskId) => !matchedTaskIds.has(taskId));

  return { matched, unmatchedCheckboxIndices, unmatchedTaskIds };
}

// ---------------------------------------------------------------------------
// Project association: section heading match
// ---------------------------------------------------------------------------

/**
 * Returns the project ID matching the checkbox's section heading,
 * or null if no match.
 */
function matchProjectByHeading(
  checkbox: ParsedCheckbox,
  knownProjects: { id: string; name: string }[],
): string | null {
  if (!checkbox.sectionHeading || knownProjects.length === 0) return null;

  const headingLower = checkbox.sectionHeading.toLowerCase().trim();
  for (const project of knownProjects) {
    if (project.name.toLowerCase() === headingLower) {
      return project.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Project association: AI content inference (batch)
// ---------------------------------------------------------------------------

interface TaskProjectAssignment {
  taskIndex: number;
  projectId: string;
}

/**
 * Batch LLM call to infer project associations for unassigned tasks.
 * Returns only valid project IDs from the known list.
 */
async function inferProjectsByContent(
  taskTexts: { index: number; text: string }[],
  knownProjects: { id: string; name: string }[],
): Promise<TaskProjectAssignment[]> {
  if (taskTexts.length === 0 || knownProjects.length === 0) return [];

  const projectList = knownProjects
    .map((project) => `- "${project.name}" (id: ${project.id})`)
    .join("\n");

  const taskList = taskTexts
    .map((task) => `${task.index}: "${task.text}"`)
    .join("\n");

  const validIds = new Set(knownProjects.map((project) => project.id));

  try {
    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You match tasks to projects. Given a list of tasks and known projects, return which project each task belongs to. Only use project IDs from the list. If a task doesn't clearly belong to any project, omit it.

Return JSON: {"assignments": [{"task_index": 0, "project_id": "uuid"}, ...]}

KNOWN PROJECTS:
${projectList}`,
          },
          {
            role: "user",
            content: `TASKS:\n${taskList}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(
        `TaskExtractor LLM call failed: ${response.status} ${errorText}`,
      );
      return [];
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    if (!Array.isArray(parsed.assignments)) return [];

    return parsed.assignments
      .filter(
        (assignment: { task_index?: unknown; project_id?: unknown }) =>
          typeof assignment.task_index === "number" &&
          typeof assignment.project_id === "string" &&
          validIds.has(assignment.project_id),
      )
      .map((assignment: { task_index: number; project_id: string }) => ({
        taskIndex: assignment.task_index,
        projectId: assignment.project_id,
      }));
  } catch (error) {
    console.error(
      `TaskExtractor LLM project inference error: ${(error as Error).message}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// TaskExtractor
// ---------------------------------------------------------------------------

export class TaskExtractor implements Extractor {
  readonly referenceKey = "tasks";

  /**
   * Optional: project IDs detected by ProjectExtractor (from pipeline references).
   * Used as default project for tasks with no heading or AI match.
   */
  private filePathProjectIds: string[] = [];

  /**
   * Set the project IDs from the pipeline's ProjectExtractor result.
   * Called before extract() when both extractors run in the pipeline.
   */
  setFilePathProjectIds(projectIds: string[]): void {
    this.filePathProjectIds = projectIds;
  }

  async extract(
    note: ParsedNote,
    context: ExtractionContext,
  ): Promise<ExtractionResult> {
    const checkboxes = note.checkboxes;
    if (checkboxes.length === 0) {
      return { referenceKey: this.referenceKey, ids: [] };
    }

    const allProjects = [
      ...context.knownProjects,
      ...context.newlyCreatedProjects,
    ];

    // Deduplicate all projects by ID
    const uniqueProjects = Array.from(
      new Map(allProjects.map((project) => [project.id, project])).values(),
    );

    // Reconcile checkboxes against known tasks
    const { matched, unmatchedCheckboxIndices } = reconcileCheckboxes(
      checkboxes,
      context.knownTasks,
    );

    // Track DB IDs by checkbox index for parent_id resolution
    const taskIdByCheckboxIndex = new Map<number, string>();
    const allTaskIds: string[] = [];

    // --- Phase 1: Determine project for each checkbox ---
    const projectByCheckboxIndex = new Map<number, string | null>();
    const unassignedForAI: { index: number; text: string }[] = [];

    for (let index = 0; index < checkboxes.length; index++) {
      // Priority 1: Section heading match
      const headingProjectId = matchProjectByHeading(checkboxes[index], uniqueProjects);
      if (headingProjectId) {
        projectByCheckboxIndex.set(index, headingProjectId);
        continue;
      }

      // Priority 2: File path project (from ProjectExtractor)
      if (this.filePathProjectIds.length > 0) {
        projectByCheckboxIndex.set(index, this.filePathProjectIds[0]);
        continue;
      }

      // Priority 3: Collect for AI batch call
      unassignedForAI.push({ index, text: checkboxes[index].text });
    }

    // AI batch inference for remaining unassigned tasks
    if (unassignedForAI.length > 0 && uniqueProjects.length > 0) {
      const assignments = await inferProjectsByContent(
        unassignedForAI,
        uniqueProjects,
      );
      for (const assignment of assignments) {
        projectByCheckboxIndex.set(assignment.taskIndex, assignment.projectId);
      }
    }

    // Fill null for any still-unassigned tasks
    for (let index = 0; index < checkboxes.length; index++) {
      if (!projectByCheckboxIndex.has(index)) {
        projectByCheckboxIndex.set(index, null);
      }
    }

    // --- Phase 2: Process matched tasks (update existing) ---
    for (const match of matched) {
      const checkbox = checkboxes[match.checkboxIndex];
      const newStatus = checkbox.checked ? "done" : "open";

      const updates: Record<string, unknown> = {
        content: checkbox.text,
        status: newStatus,
        project_id: projectByCheckboxIndex.get(match.checkboxIndex) || null,
      };

      if (newStatus === "done") {
        updates.archived_at = new Date().toISOString();
      } else {
        updates.archived_at = null;
      }

      await context.supabase
        .from("tasks")
        .update(updates)
        .eq("id", match.existingTaskId);

      taskIdByCheckboxIndex.set(match.checkboxIndex, match.existingTaskId);
      allTaskIds.push(match.existingTaskId);
    }

    // --- Phase 3: Create new tasks for unmatched checkboxes ---
    // Process in order so parents are created before children
    for (const checkboxIndex of unmatchedCheckboxIndices) {
      const checkbox = checkboxes[checkboxIndex];
      const status = checkbox.checked ? "done" : "open";

      // Resolve parent_id from already-processed parent checkbox
      let parentId: string | null = null;
      if (checkbox.parentIndex !== null) {
        parentId = taskIdByCheckboxIndex.get(checkbox.parentIndex) || null;
      }

      const insertData: Record<string, unknown> = {
        content: checkbox.text,
        status,
        reference_id: note.referenceId,
        project_id: projectByCheckboxIndex.get(checkboxIndex) || null,
        parent_id: parentId,
      };

      if (status === "done") {
        insertData.archived_at = new Date().toISOString();
      }

      const { data: newTask, error } = await context.supabase
        .from("tasks")
        .insert(insertData)
        .select("id, content")
        .single();

      if (!error && newTask) {
        taskIdByCheckboxIndex.set(checkboxIndex, newTask.id);
        allTaskIds.push(newTask.id);
        context.newlyCreatedTasks.push({
          id: newTask.id,
          content: newTask.content,
        });
      } else {
        console.error(
          `TaskExtractor insert failed for "${checkbox.text}": ${error?.message}`,
        );
      }
    }

    // --- Phase 4: Update parent_id for matched tasks whose parent changed ---
    for (const match of matched) {
      const checkbox = checkboxes[match.checkboxIndex];
      if (checkbox.parentIndex !== null) {
        const parentId = taskIdByCheckboxIndex.get(checkbox.parentIndex) || null;
        await context.supabase
          .from("tasks")
          .update({ parent_id: parentId })
          .eq("id", match.existingTaskId);
      }
    }

    return {
      referenceKey: this.referenceKey,
      ids: allTaskIds,
    };
  }
}
