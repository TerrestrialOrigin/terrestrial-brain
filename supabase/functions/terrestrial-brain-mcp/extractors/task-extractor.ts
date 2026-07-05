/**
 * TaskExtractor — detects tasks from note checkboxes.
 *
 * Converts ParsedCheckbox[] into task rows with:
 * - Project association via priority chain (section heading > file path > AI inference)
 * - Subtask hierarchy from indentation (parent_id)
 * - Reconciliation against existing tasks on re-ingest (with containment fallback)
 * - Metadata with extraction context (source, section_heading)
 * - Due date extraction: regex fast path + AI fallback
 * - People assignment: explicit pattern fast path + AI fallback
 */

import type { ParsedCheckbox, ParsedNote } from "../parser.ts";
import type {
  ExtractionContext,
  ExtractionResult,
  Extractor,
} from "./pipeline.ts";
import {
  cleanStrippedText,
  extractDueDate,
  getConfiguredTimeZone,
  getZonedDate,
} from "./date-parser.ts";
import { findPersonInText } from "./name-matching.ts";
import type { AiProvider } from "../ai/ai-provider.ts";

// ---------------------------------------------------------------------------
// Content similarity
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function computeSimilarity(textA: string, textB: string): number {
  const normalizedA = normalizeText(textA);
  const normalizedB = normalizeText(textB);

  if (normalizedA === normalizedB) return 1.0;
  if (normalizedA.length === 0 || normalizedB.length === 0) return 0.0;

  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  const lcsLength = longestCommonSubsequenceLength(normalizedA, normalizedB);

  return lcsLength / maxLength;
}

function longestCommonSubsequenceLength(
  textA: string,
  textB: string,
): number {
  const lengthA = textA.length;
  const lengthB = textB.length;

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
const CONTAINMENT_THRESHOLD = 0.85;
const MIN_CONTAINMENT_LENGTH = 10;

// ---------------------------------------------------------------------------
// Task reconciliation (two-pass: similarity + containment fallback)
// ---------------------------------------------------------------------------

interface TaskMatch {
  existingTaskId: string;
  checkboxIndex: number;
  similarity: number;
}

/**
 * Strips common metadata markers from checkbox text so reconciliation
 * compares apples-to-apples against stored (already-cleaned) content.
 * E.g. "Fix bug (assigned: Alice) (deadline: March 30)" → "Fix bug"
 */
function stripMarkersForComparison(text: string): string {
  return text
    .replace(/\(\s*(?:assigned|owner|assignee)\s*:[^)]*\)/gi, "")
    .replace(/\(\s*(?:due|by|deadline|before)\s*:?[^)]*\)/gi, "")
    .replace(
      /(?:,?\s*)(?:due|by|deadline|before)\s*:?\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/gi,
      "",
    )
    .replace(
      /(?:,?\s*)(?:due|by|deadline|before)\s*:?\s*\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi,
      "",
    )
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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

  // Pre-clean checkbox text for comparison: strip metadata markers so
  // similarity is computed against core task content, not annotations.
  // Stored task content is already cleaned, so we need to clean checkbox
  // text to match.
  const cleanedCheckboxTexts = checkboxes.map(
    (checkbox) => stripMarkersForComparison(checkbox.text),
  );

  // --- Pass 1: High similarity (LCS/maxLength >= 0.8) ---
  const candidates: TaskMatch[] = [];
  for (
    let checkboxIndex = 0;
    checkboxIndex < checkboxes.length;
    checkboxIndex++
  ) {
    for (const task of knownTasks) {
      const similarity = computeSimilarity(
        cleanedCheckboxTexts[checkboxIndex],
        task.content,
      );
      if (similarity >= SIMILARITY_THRESHOLD) {
        candidates.push({ existingTaskId: task.id, checkboxIndex, similarity });
      }
    }
  }

  candidates.sort((candidateA, candidateB) =>
    candidateB.similarity - candidateA.similarity
  );

  const matchedCheckboxIndices = new Set<number>();
  const matchedTaskIds = new Set<string>();
  const matched: TaskMatch[] = [];

  for (const candidate of candidates) {
    if (
      matchedCheckboxIndices.has(candidate.checkboxIndex) ||
      matchedTaskIds.has(candidate.existingTaskId)
    ) continue;
    matched.push(candidate);
    matchedCheckboxIndices.add(candidate.checkboxIndex);
    matchedTaskIds.add(candidate.existingTaskId);
  }

  // --- Pass 2: Containment fallback (LCS/minLength >= 0.85) ---
  // Catches edits where user adds metadata like "(assigned: Alice)" to an
  // existing task — the original text is fully contained in the new text.
  const remainingCheckboxIndices = checkboxes
    .map((_, index) => index)
    .filter((index) => !matchedCheckboxIndices.has(index));
  const remainingTasks = knownTasks
    .filter((task) => !matchedTaskIds.has(task.id));

  if (remainingCheckboxIndices.length > 0 && remainingTasks.length > 0) {
    const containmentCandidates: TaskMatch[] = [];

    for (const checkboxIndex of remainingCheckboxIndices) {
      const checkboxNormalized = normalizeText(
        cleanedCheckboxTexts[checkboxIndex],
      );
      for (const task of remainingTasks) {
        const taskNormalized = normalizeText(task.content);
        const minLength = Math.min(
          checkboxNormalized.length,
          taskNormalized.length,
        );
        if (minLength < MIN_CONTAINMENT_LENGTH) continue;

        const lcsLength = longestCommonSubsequenceLength(
          checkboxNormalized,
          taskNormalized,
        );
        const containmentScore = lcsLength / minLength;

        if (containmentScore >= CONTAINMENT_THRESHOLD) {
          containmentCandidates.push({
            existingTaskId: task.id,
            checkboxIndex,
            similarity: containmentScore,
          });
        }
      }
    }

    containmentCandidates.sort((candidateA, candidateB) =>
      candidateB.similarity - candidateA.similarity
    );

    for (const candidate of containmentCandidates) {
      if (
        matchedCheckboxIndices.has(candidate.checkboxIndex) ||
        matchedTaskIds.has(candidate.existingTaskId)
      ) continue;
      matched.push(candidate);
      matchedCheckboxIndices.add(candidate.checkboxIndex);
      matchedTaskIds.add(candidate.existingTaskId);
    }
  }

  return {
    matched,
    unmatchedCheckboxIndices: checkboxes
      .map((_, index) => index)
      .filter((index) => !matchedCheckboxIndices.has(index)),
    unmatchedTaskIds: knownTasks
      .map((task) => task.id)
      .filter((taskId) => !matchedTaskIds.has(taskId)),
  };
}

// ---------------------------------------------------------------------------
// Project association
// ---------------------------------------------------------------------------

function matchProjectByHeading(
  checkbox: ParsedCheckbox,
  knownProjects: { id: string; name: string }[],
): string | null {
  if (!checkbox.sectionHeading || knownProjects.length === 0) return null;
  const headingLower = checkbox.sectionHeading.toLowerCase().trim();
  for (const project of knownProjects) {
    if (project.name.toLowerCase() === headingLower) return project.id;
  }
  return null;
}

interface TaskProjectAssignment {
  taskIndex: number;
  projectId: string;
}

async function inferProjectsByContent(
  taskTexts: { index: number; text: string }[],
  knownProjects: { id: string; name: string }[],
  aiProvider: AiProvider,
): Promise<{ ok: boolean; assignments: TaskProjectAssignment[] }> {
  if (taskTexts.length === 0 || knownProjects.length === 0) {
    return { ok: true, assignments: [] };
  }

  const projectList = knownProjects
    .map((project) => `- "${project.name}" (id: ${project.id})`)
    .join("\n");
  const taskList = taskTexts
    .map((task) => `${task.index}: "${task.text}"`)
    .join("\n");
  const validIds = new Set(knownProjects.map((project) => project.id));

  // A transport/parse failure returns { ok: false } so the caller keeps existing
  // project assignments untouched; a well-formed-but-empty response is { ok: true }.
  try {
    return await aiProvider.completeJson(
      {
        systemPrompt:
          `You match tasks to projects. Given a list of tasks and known projects, return which project each task belongs to. Only use project IDs from the list. If a task doesn't clearly belong to any project, omit it.

Return JSON: {"assignments": [{"task_index": 0, "project_id": "uuid"}, ...]}

KNOWN PROJECTS:
${projectList}`,
        userContent: `TASKS:\n${taskList}`,
      },
      (raw): { ok: true; assignments: TaskProjectAssignment[] } => {
        const parsed = raw as { assignments?: unknown };
        if (!Array.isArray(parsed.assignments)) {
          return { ok: true, assignments: [] };
        }
        const assignments = parsed.assignments
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
        return { ok: true, assignments };
      },
    );
  } catch (error) {
    console.error(
      `TaskExtractor LLM project inference error: ${(error as Error).message}`,
    );
    return { ok: false, assignments: [] };
  }
}

// ---------------------------------------------------------------------------
// Re-ingest merge policy (finding C6 / fix-plan Step 8)
// ---------------------------------------------------------------------------

/**
 * Applies the matched-task re-ingest merge policy for one field, consistently
 * across `project_id`, `due_by`, and `assigned_to`:
 * - `unavailable` (resolution could not complete — LLM error, or no capability
 *   to resolve) → omit the column so the stored value is preserved;
 * - resolved to a concrete value → set the column to that value;
 * - resolved to empty (`null`) — resolution ran and found nothing, i.e. the
 *   note removed the cue → set the column to `null` (clear).
 * This is what stops an LLM outage from nulling an existing association.
 */
function applyMergeField(
  updates: Record<string, unknown>,
  column: string,
  value: string | null,
  unavailable: boolean,
): void {
  if (unavailable) return;
  updates[column] = value;
}

// ---------------------------------------------------------------------------
// Metadata builder
// ---------------------------------------------------------------------------

export function buildTaskMetadata(
  source: string,
  sectionHeading: string | null,
): Record<string, string> {
  const metadata: Record<string, string> = { source };
  if (sectionHeading) {
    metadata.section_heading = sectionHeading;
  }
  return metadata;
}

// ---------------------------------------------------------------------------
// Person matching: explicit pattern fast path
// ---------------------------------------------------------------------------

const ASSIGNMENT_PATTERN =
  /\(\s*(?:assigned|owner|assignee)\s*:\s*([^)]+?)\s*\)/i;

/**
 * Fast path: extracts explicit "(assigned: Alice)" / "(owner: Bob)" patterns.
 * Strips the pattern from content if person is found.
 * Does NOT do substring matching — that's handled by AI fallback.
 */
export function extractAssignment(
  text: string,
  knownPeople: { id: string; name: string }[],
): { personId: string | null; cleanedText: string } {
  if (knownPeople.length === 0) return { personId: null, cleanedText: text };

  const match = text.match(ASSIGNMENT_PATTERN);
  if (!match) return { personId: null, cleanedText: text };

  const candidateName = match[1].trim().toLowerCase();
  for (const person of knownPeople) {
    const personLower = person.name.toLowerCase();
    if (
      personLower === candidateName ||
      candidateName.includes(personLower) ||
      personLower.includes(candidateName)
    ) {
      return {
        personId: person.id,
        cleanedText: cleanStrippedText(text.replace(match[0], "")),
      };
    }
  }

  return { personId: null, cleanedText: text };
}

/**
 * Returns the first known person whose name (or name part) appears in
 * the text. Full-name matches take priority; partial name-part matches
 * are returned only when exactly one person matches (unambiguous).
 * Delegates to shared utility.
 */
export function matchPersonInText(
  text: string,
  knownPeople: { id: string; name: string }[],
): string | null {
  return findPersonInText(text, knownPeople);
}

// ---------------------------------------------------------------------------
// AI enrichment: combined date + person extraction for unresolved tasks
// ---------------------------------------------------------------------------

interface TaskEnrichment {
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
async function inferTaskEnrichments(
  tasks: { index: number; text: string; sectionHeading: string | null }[],
  knownPeople: { id: string; name: string }[],
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
    ? knownPeople.map((person) => `- "${person.name}" (id: ${person.id})`).join(
      "\n",
    )
    : "(no known people)";

  const validPeopleIds = new Set(knownPeople.map((person) => person.id));

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
  try {
    return await aiProvider.completeJson(
      {
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
      (raw): { ok: true; enrichments: TaskEnrichment[] } => {
        const parsed = raw as { enrichments?: unknown };
        if (!Array.isArray(parsed.enrichments)) {
          return { ok: true, enrichments: [] };
        }
        const enrichments = parsed.enrichments
          .filter(
            (entry: Record<string, unknown>) =>
              typeof entry.task_index === "number" &&
              typeof entry.cleaned_text === "string",
          )
          .map((
            entry: {
              task_index: number;
              assigned_to_id?: string | null;
              due_date?: string | null;
              cleaned_text: string;
            },
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
    );
  } catch (error) {
    console.error(`Task enrichment LLM error: ${(error as Error).message}`);
    return { ok: false, enrichments: [] };
  }
}

// ---------------------------------------------------------------------------
// TaskExtractor
// ---------------------------------------------------------------------------

export class TaskExtractor implements Extractor {
  readonly referenceKey = "tasks";

  async extract(
    note: ParsedNote,
    context: ExtractionContext,
  ): Promise<ExtractionResult> {
    const checkboxes = note.checkboxes;
    if (checkboxes.length === 0) {
      return { referenceKey: this.referenceKey, ids: [] };
    }

    // Relative dates ("today"/"tomorrow"/weekday names) resolve against this
    // instant, interpreted in the configured user timezone (default UTC) rather
    // than the server's UTC clock. Read once per run — see fix-plan Step 9 / C7.
    const userTimeZone = getConfiguredTimeZone();
    const referenceDate = new Date();

    const allProjects = [
      ...context.knownProjects,
      ...context.newlyCreatedProjects,
    ];
    const uniqueProjects = Array.from(
      new Map(allProjects.map((project) => [project.id, project])).values(),
    );

    const allPeople = [...context.knownPeople, ...context.newlyCreatedPeople];
    const uniquePeople = Array.from(
      new Map(allPeople.map((person) => [person.id, person])).values(),
    );

    // Reconcile checkboxes against known tasks
    const { matched, unmatchedCheckboxIndices, unmatchedTaskIds } =
      reconcileCheckboxes(
        checkboxes,
        context.knownTasks,
      );

    const taskIdByCheckboxIndex = new Map<number, string>();
    const allTaskIds: string[] = [];
    // Write failures surfaced (not swallowed) — see finding C6 / Step 8.
    const errors: string[] = [];

    // --- Phase 1: Determine project for each checkbox ---
    // `projectByCheckboxIndex` holds only POSITIVELY resolved project ids.
    // `projectUnavailable` marks checkboxes whose project resolution could not
    // complete (LLM error, or no projects to infer against) — their existing
    // project_id must be preserved, never nulled.
    const projectByCheckboxIndex = new Map<number, string>();
    const projectUnavailable = new Set<number>();
    const unassignedForAI: { index: number; text: string }[] = [];

    for (let index = 0; index < checkboxes.length; index++) {
      const headingProjectId = matchProjectByHeading(
        checkboxes[index],
        uniqueProjects,
      );
      if (headingProjectId) {
        projectByCheckboxIndex.set(index, headingProjectId);
        continue;
      }

      const pipelineProjectIds = context.accumulatedReferences.projects || [];
      if (pipelineProjectIds.length > 0) {
        projectByCheckboxIndex.set(index, pipelineProjectIds[0]);
        continue;
      }

      unassignedForAI.push({ index, text: checkboxes[index].text });
    }

    let projectInferenceRan = false;
    if (unassignedForAI.length > 0 && uniqueProjects.length > 0) {
      const { ok, assignments } = await inferProjectsByContent(
        unassignedForAI,
        uniqueProjects,
        context.aiProvider,
      );
      if (ok) {
        projectInferenceRan = true;
        for (const assignment of assignments) {
          projectByCheckboxIndex.set(
            assignment.taskIndex,
            assignment.projectId,
          );
        }
      }
    }

    // A checkbox that needed LLM project inference but stayed unresolved is
    // "unavailable" UNLESS the inference call actually ran (a successful call
    // that simply assigned nothing = resolved-to-empty, which clears).
    for (const candidate of unassignedForAI) {
      if (
        !projectByCheckboxIndex.has(candidate.index) && !projectInferenceRan
      ) {
        projectUnavailable.add(candidate.index);
      }
    }

    // --- Phase 1b: Extract dates, assignments, and clean content ---
    // Like projects: the *ByIndex maps hold only positively resolved values;
    // the *Unavailable sets mark fields whose AI enrichment was needed but could
    // not complete, so their existing stored value is preserved (not cleared).
    const contentByIndex = new Map<number, string>();
    const dueDateByIndex = new Map<number, string>();
    const assignedToByIndex = new Map<number, string>();
    const dateUnavailable = new Set<number>();
    const personUnavailable = new Set<number>();
    const aiCandidates: {
      index: number;
      text: string;
      sectionHeading: string | null;
      needsDate: boolean;
      needsPerson: boolean;
    }[] = [];

    for (let index = 0; index < checkboxes.length; index++) {
      let text = checkboxes[index].text;
      let needsAIDate = true;
      let needsAIPerson = true;

      // Fast path: regex date extraction
      const dateResult = extractDueDate(text, referenceDate, userTimeZone);
      if (dateResult.dueDate) {
        dueDateByIndex.set(index, dateResult.dueDate);
        text = dateResult.cleanedText;
        needsAIDate = false;
      }

      // Fast path 1: explicit assignment pattern "(assigned: X)" / "(owner: X)"
      const assignResult = extractAssignment(text, uniquePeople);
      if (assignResult.personId) {
        assignedToByIndex.set(index, assignResult.personId);
        text = assignResult.cleanedText;
        needsAIPerson = false;
      } else {
        // Fast path 2: person name substring in checkbox text
        const substringMatch = matchPersonInText(text, uniquePeople);
        if (substringMatch) {
          assignedToByIndex.set(index, substringMatch);
          needsAIPerson = false;
        } else if (checkboxes[index].sectionHeading) {
          // Fast path 3: person name in section heading
          const headingMatch = matchPersonInText(
            checkboxes[index].sectionHeading!,
            uniquePeople,
          );
          if (headingMatch) {
            assignedToByIndex.set(index, headingMatch);
            needsAIPerson = false;
          }
        }
      }

      contentByIndex.set(index, cleanStrippedText(text));

      // Queue for AI enrichment if either date or person still unresolved
      if (needsAIDate || needsAIPerson) {
        aiCandidates.push({
          index,
          text: checkboxes[index].text, // Send original text for AI context
          sectionHeading: checkboxes[index].sectionHeading,
          needsDate: needsAIDate,
          needsPerson: needsAIPerson,
        });
      }
    }

    // AI batch enrichment for unresolved dates + people
    let enrichmentRan = false;
    if (
      aiCandidates.length > 0 &&
      (uniquePeople.length > 0 ||
        aiCandidates.some((candidate) => !dueDateByIndex.has(candidate.index)))
    ) {
      const { ok, enrichments } = await inferTaskEnrichments(
        aiCandidates,
        uniquePeople,
        context.aiProvider,
        referenceDate,
        userTimeZone,
      );
      if (ok) {
        enrichmentRan = true;
        for (const enrichment of enrichments) {
          // Only apply AI results for fields not already resolved by regex/pattern
          const resolvedDate = !dueDateByIndex.has(enrichment.taskIndex) &&
            enrichment.dueDate;
          const resolvedPerson = !assignedToByIndex.has(enrichment.taskIndex) &&
            enrichment.assignedToId;

          if (resolvedDate) {
            dueDateByIndex.set(enrichment.taskIndex, enrichment.dueDate!);
          }
          if (resolvedPerson) {
            assignedToByIndex.set(
              enrichment.taskIndex,
              enrichment.assignedToId!,
            );
          }
          // Only use AI-cleaned text if AI actually resolved something.
          // Otherwise we'd strip markers (like "(assigned: X)") from content
          // without storing the info anywhere — losing data.
          if ((resolvedDate || resolvedPerson) && enrichment.cleanedText) {
            contentByIndex.set(
              enrichment.taskIndex,
              cleanStrippedText(enrichment.cleanedText),
            );
          }
        }
      }
    }

    // A field that needed AI enrichment but stayed unresolved is "unavailable"
    // UNLESS enrichment actually ran (a successful call that found nothing =
    // resolved-to-empty, which clears the field on matched tasks).
    for (const candidate of aiCandidates) {
      if (
        candidate.needsDate && !dueDateByIndex.has(candidate.index) &&
        !enrichmentRan
      ) {
        dateUnavailable.add(candidate.index);
      }
      if (
        candidate.needsPerson && !assignedToByIndex.has(candidate.index) &&
        !enrichmentRan
      ) {
        personUnavailable.add(candidate.index);
      }
    }

    // --- Phase 2: Process matched tasks (update existing) ---
    for (const match of matched) {
      const checkbox = checkboxes[match.checkboxIndex];
      const newStatus = checkbox.checked ? "done" : "open";
      const content = contentByIndex.get(match.checkboxIndex) ?? checkbox.text;
      const metadata = buildTaskMetadata(note.source, checkbox.sectionHeading);

      const updates: Record<string, unknown> = {
        content,
        status: newStatus,
        metadata,
      };

      // Merge policy: set when resolved, clear when resolved-empty, preserve
      // (omit) when resolution was unavailable. Same rule for all three fields.
      applyMergeField(
        updates,
        "project_id",
        projectByCheckboxIndex.get(match.checkboxIndex) ?? null,
        projectUnavailable.has(match.checkboxIndex),
      );
      applyMergeField(
        updates,
        "assigned_to",
        assignedToByIndex.get(match.checkboxIndex) ?? null,
        personUnavailable.has(match.checkboxIndex),
      );
      applyMergeField(
        updates,
        "due_by",
        dueDateByIndex.get(match.checkboxIndex) ?? null,
        dateUnavailable.has(match.checkboxIndex),
      );

      if (newStatus === "done") {
        updates.archived_at = new Date().toISOString();
      } else {
        updates.archived_at = null;
      }

      const { error: updateError } = await context.supabase
        .from("tasks")
        .update(updates)
        .eq("id", match.existingTaskId);
      if (updateError) {
        errors.push(
          `Failed to update task ${match.existingTaskId}: ${updateError.message}`,
        );
      }

      taskIdByCheckboxIndex.set(match.checkboxIndex, match.existingTaskId);
      allTaskIds.push(match.existingTaskId);
    }

    // --- Phase 3: Create new tasks for unmatched checkboxes ---
    for (const checkboxIndex of unmatchedCheckboxIndices) {
      const checkbox = checkboxes[checkboxIndex];
      const status = checkbox.checked ? "done" : "open";
      const content = contentByIndex.get(checkboxIndex) ?? checkbox.text;

      let parentId: string | null = null;
      if (checkbox.parentIndex !== null) {
        parentId = taskIdByCheckboxIndex.get(checkbox.parentIndex) || null;
      }

      const metadata = buildTaskMetadata(note.source, checkbox.sectionHeading);

      const insertData: Record<string, unknown> = {
        content,
        status,
        reference_id: note.referenceId,
        project_id: projectByCheckboxIndex.get(checkboxIndex) || null,
        parent_id: parentId,
        metadata,
      };

      const assignedTo = assignedToByIndex.get(checkboxIndex);
      if (assignedTo) insertData.assigned_to = assignedTo;

      const dueDate = dueDateByIndex.get(checkboxIndex);
      if (dueDate) insertData.due_by = dueDate;

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
        errors.push(
          `Failed to create task for "${checkbox.text}": ${
            error?.message ?? "unknown error"
          }`,
        );
      }
    }

    // --- Phase 4: Update parent_id for matched tasks whose parent changed ---
    for (const match of matched) {
      const checkbox = checkboxes[match.checkboxIndex];
      if (checkbox.parentIndex !== null) {
        const parentId = taskIdByCheckboxIndex.get(checkbox.parentIndex) ||
          null;
        const { error: parentError } = await context.supabase
          .from("tasks")
          .update({ parent_id: parentId })
          .eq("id", match.existingTaskId);
        if (parentError) {
          errors.push(
            `Failed to update parent_id for task ${match.existingTaskId}: ${parentError.message}`,
          );
        }
      }
    }

    // --- Phase 5: Archive tasks whose checkboxes were removed from the note ---
    if (unmatchedTaskIds.length > 0) {
      for (const taskId of unmatchedTaskIds) {
        const { error: archiveError } = await context.supabase
          .from("tasks")
          .update({ archived_at: new Date().toISOString(), status: "done" })
          .eq("id", taskId)
          .is("archived_at", null); // Only archive if not already archived
        if (archiveError) {
          errors.push(
            `Failed to archive task ${taskId}: ${archiveError.message}`,
          );
        }
      }
    }

    return {
      referenceKey: this.referenceKey,
      ids: allTaskIds,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }
}
