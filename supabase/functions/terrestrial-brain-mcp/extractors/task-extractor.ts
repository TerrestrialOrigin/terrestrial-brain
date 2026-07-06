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
  KnownProject,
  KnownTask,
} from "./pipeline.ts";
import { REFERENCE_KEYS } from "./pipeline.ts";
import type { KnownPerson } from "./name-matching.ts";
import {
  cleanStrippedText,
  extractDueDate,
  getConfiguredTimeZone,
  getZonedDate,
} from "./date-parser.ts";
import { findPersonInText } from "./name-matching.ts";
import { ASSIGNMENT_MARKER_PATTERN, DUE_MARKER_PATTERN } from "./markers.ts";
import type { AiProvider } from "../ai/ai-provider.ts";
import type { NewTaskValues } from "../repositories/task-repository.ts";

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
// Greedy one-to-one assignment (shared by both reconciliation passes)
// ---------------------------------------------------------------------------

export interface ScoredPair {
  checkboxIndex: number;
  taskId: string;
  score: number;
}

/**
 * Accepts scored checkbox↔task candidate pairs greedily in descending score
 * order, skipping any pair below `threshold` and any pair whose checkbox index
 * or task id has already been taken. The result is strictly one-to-one: no
 * checkbox and no task appears in more than one accepted pair. Both the
 * similarity and containment reconciliation passes use this single helper.
 */
export function greedyMatch(
  pairs: ScoredPair[],
  threshold: number,
): ScoredPair[] {
  const ranked = pairs
    .filter((pair) => pair.score >= threshold)
    .sort((pairA, pairB) => pairB.score - pairA.score);

  const takenCheckboxIndices = new Set<number>();
  const takenTaskIds = new Set<string>();
  const accepted: ScoredPair[] = [];

  for (const pair of ranked) {
    if (
      takenCheckboxIndices.has(pair.checkboxIndex) ||
      takenTaskIds.has(pair.taskId)
    ) continue;
    accepted.push(pair);
    takenCheckboxIndices.add(pair.checkboxIndex);
    takenTaskIds.add(pair.taskId);
  }

  return accepted;
}

// ---------------------------------------------------------------------------
// LCS prefilters — cheap necessary conditions that gate the O(len²) DP
// ---------------------------------------------------------------------------

/**
 * Character-multiset overlap: Σ min(count_A(c), count_B(c)). The longest common
 * subsequence can never exceed this (every matched character must appear in
 * both strings), so it is a rigorous upper bound on LCS length — and therefore
 * a safe basis for pruning pairs that provably cannot clear a score threshold.
 * O(len) instead of the O(lenA × lenB) DP.
 */
function characterMultisetOverlap(textA: string, textB: string): number {
  const remaining = new Map<string, number>();
  for (const character of textA) {
    remaining.set(character, (remaining.get(character) ?? 0) + 1);
  }
  let overlap = 0;
  for (const character of textB) {
    const available = remaining.get(character) ?? 0;
    if (available > 0) {
      overlap++;
      remaining.set(character, available - 1);
    }
  }
  return overlap;
}

/**
 * Similarity score (LCS / maxLength) with prefilters. Returns null when the
 * pair provably cannot reach SIMILARITY_THRESHOLD, so the DP is skipped. Each
 * gate is a necessary condition, so the accepted set is identical to running
 * the full LCS on every pair.
 */
function scoreSimilarityPair(
  cleanedCheckboxText: string,
  taskContent: string,
  usePrefilter: boolean,
): number | null {
  const normalizedCheckbox = normalizeText(cleanedCheckboxText);
  const normalizedTask = normalizeText(taskContent);
  if (normalizedCheckbox.length === 0 || normalizedTask.length === 0) {
    return null;
  }
  if (normalizedCheckbox === normalizedTask) return 1.0; // exact-match fast accept

  if (usePrefilter) {
    const maxLength = Math.max(
      normalizedCheckbox.length,
      normalizedTask.length,
    );
    // LCS ≤ min(len) and LCS ≤ characterMultisetOverlap → similarity upper bound.
    const lcsUpperBound = Math.min(
      Math.min(normalizedCheckbox.length, normalizedTask.length),
      characterMultisetOverlap(normalizedCheckbox, normalizedTask),
    );
    if (lcsUpperBound / maxLength < SIMILARITY_THRESHOLD) return null;
  }

  return computeSimilarity(cleanedCheckboxText, taskContent);
}

/**
 * Containment score (LCS / minLength) with prefilters. Returns null when the
 * shorter text is below MIN_CONTAINMENT_LENGTH, or when the pair provably
 * cannot reach CONTAINMENT_THRESHOLD.
 */
function scoreContainmentPair(
  cleanedCheckboxText: string,
  taskContent: string,
  usePrefilter: boolean,
): number | null {
  const normalizedCheckbox = normalizeText(cleanedCheckboxText);
  const normalizedTask = normalizeText(taskContent);
  const minLength = Math.min(
    normalizedCheckbox.length,
    normalizedTask.length,
  );
  if (minLength < MIN_CONTAINMENT_LENGTH) return null;

  if (usePrefilter) {
    // LCS ≤ characterMultisetOverlap → containment upper bound.
    const lcsUpperBound = characterMultisetOverlap(
      normalizedCheckbox,
      normalizedTask,
    );
    if (lcsUpperBound / minLength < CONTAINMENT_THRESHOLD) return null;
  }

  const lcsLength = longestCommonSubsequenceLength(
    normalizedCheckbox,
    normalizedTask,
  );
  return lcsLength / minLength;
}

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
export function stripMarkersForComparison(text: string): string {
  return text
    .replace(
      new RegExp(`\\(\\s*${ASSIGNMENT_MARKER_PATTERN}\\s*:[^)]*\\)`, "gi"),
      "",
    )
    .replace(
      new RegExp(`\\(\\s*${DUE_MARKER_PATTERN}\\s*:?[^)]*\\)`, "gi"),
      "",
    )
    .replace(
      new RegExp(
        `(?:,?\\s*)${DUE_MARKER_PATTERN}\\s*:?\\s*\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}`,
        "gi",
      ),
      "",
    )
    .replace(
      new RegExp(
        `(?:,?\\s*)${DUE_MARKER_PATTERN}\\s*:?\\s*\\w+\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
        "gi",
      ),
      "",
    )
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

interface ReconcileResult {
  matched: TaskMatch[];
  unmatchedCheckboxIndices: number[];
  unmatchedTaskIds: string[];
}

/** Pass 1: high-similarity matches (LCS/maxLength >= SIMILARITY_THRESHOLD). */
function matchBySimilarity(
  cleanedCheckboxTexts: string[],
  knownTasks: KnownTask[],
  usePrefilter: boolean,
): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  for (
    let checkboxIndex = 0;
    checkboxIndex < cleanedCheckboxTexts.length;
    checkboxIndex++
  ) {
    for (const task of knownTasks) {
      const score = scoreSimilarityPair(
        cleanedCheckboxTexts[checkboxIndex],
        task.content,
        usePrefilter,
      );
      if (score !== null && score >= SIMILARITY_THRESHOLD) {
        pairs.push({ checkboxIndex, taskId: task.id, score });
      }
    }
  }
  return greedyMatch(pairs, SIMILARITY_THRESHOLD);
}

/**
 * Pass 2: containment fallback (LCS/minLength >= CONTAINMENT_THRESHOLD).
 * Catches edits where the user adds metadata like "(assigned: Alice)" to an
 * existing task — the original text is fully contained in the new text.
 */
function matchByContainment(
  cleanedCheckboxTexts: string[],
  remainingCheckboxIndices: number[],
  remainingTasks: KnownTask[],
  usePrefilter: boolean,
): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  for (const checkboxIndex of remainingCheckboxIndices) {
    for (const task of remainingTasks) {
      const score = scoreContainmentPair(
        cleanedCheckboxTexts[checkboxIndex],
        task.content,
        usePrefilter,
      );
      if (score !== null && score >= CONTAINMENT_THRESHOLD) {
        pairs.push({ checkboxIndex, taskId: task.id, score });
      }
    }
  }
  return greedyMatch(pairs, CONTAINMENT_THRESHOLD);
}

function reconcileCheckboxes(
  checkboxes: ParsedCheckbox[],
  knownTasks: KnownTask[],
  usePrefilter = true,
): ReconcileResult {
  if (knownTasks.length === 0) {
    return {
      matched: [],
      unmatchedCheckboxIndices: checkboxes.map((_, index) => index),
      unmatchedTaskIds: [],
    };
  }

  // Pre-clean checkbox text for comparison: strip metadata markers so
  // similarity is computed against core task content, not annotations.
  // Stored task content is already cleaned, so we clean checkbox text to match.
  const cleanedCheckboxTexts = checkboxes.map(
    (checkbox) => stripMarkersForComparison(checkbox.text),
  );

  const matchedCheckboxIndices = new Set<number>();
  const matchedTaskIds = new Set<string>();
  const matched: TaskMatch[] = [];

  const record = (pair: ScoredPair) => {
    matched.push({
      existingTaskId: pair.taskId,
      checkboxIndex: pair.checkboxIndex,
      similarity: pair.score,
    });
    matchedCheckboxIndices.add(pair.checkboxIndex);
    matchedTaskIds.add(pair.taskId);
  };

  for (
    const pair of matchBySimilarity(
      cleanedCheckboxTexts,
      knownTasks,
      usePrefilter,
    )
  ) record(pair);

  const remainingCheckboxIndices = checkboxes
    .map((_, index) => index)
    .filter((index) => !matchedCheckboxIndices.has(index));
  const remainingTasks = knownTasks
    .filter((task) => !matchedTaskIds.has(task.id));

  if (remainingCheckboxIndices.length > 0 && remainingTasks.length > 0) {
    for (
      const pair of matchByContainment(
        cleanedCheckboxTexts,
        remainingCheckboxIndices,
        remainingTasks,
        usePrefilter,
      )
    ) record(pair);
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

/**
 * Test-only seam: reconcile from bare checkbox text strings with the prefilter
 * toggle exposed, so a unit test can assert the prefiltered result equals the
 * brute-force (full-LCS) result. Not used in production code paths.
 */
export function reconcileCheckboxesForTest(
  checkboxTexts: string[],
  knownTasks: KnownTask[],
  usePrefilter: boolean,
): ReconcileResult {
  const checkboxes: ParsedCheckbox[] = checkboxTexts.map((text, index) => ({
    text,
    checked: false,
    depth: 0,
    lineNumber: index,
    parentIndex: null,
    sectionHeading: null,
  }));
  return reconcileCheckboxes(checkboxes, knownTasks, usePrefilter);
}

// ---------------------------------------------------------------------------
// Project association
// ---------------------------------------------------------------------------

function matchProjectByHeading(
  checkbox: ParsedCheckbox,
  knownProjects: KnownProject[],
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
  knownProjects: KnownProject[],
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

const ASSIGNMENT_PATTERN = new RegExp(
  `\\(\\s*${ASSIGNMENT_MARKER_PATTERN}\\s*:\\s*([^)]+?)\\s*\\)`,
  "i",
);

/**
 * Fast path: extracts explicit "(assigned: Alice)" / "(owner: Bob)" patterns.
 * Strips the pattern from content if person is found.
 * Does NOT do substring matching — that's handled by AI fallback.
 */
export function extractAssignment(
  text: string,
  knownPeople: KnownPerson[],
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
// Per-checkbox resolution state
// ---------------------------------------------------------------------------

/**
 * The resolution outcome for a single checkbox, carried as one object instead
 * of six index-keyed containers. `content` holds the cleaned task text;
 * `projectId`/`dueDate`/`assignedTo` hold positively-resolved values (null when
 * unresolved); the `*Unavailable` flags mark fields whose resolution could not
 * complete (LLM error, or no capability) so a matched task's stored value is
 * preserved rather than cleared (finding C6 merge policy).
 */
interface EnrichedCheckbox {
  index: number;
  content: string;
  projectId: string | null;
  dueDate: string | null;
  assignedTo: string | null;
  projectUnavailable: boolean;
  dateUnavailable: boolean;
  personUnavailable: boolean;
}

/** A checkbox still needing LLM enrichment for its date and/or assignee. */
interface AiCandidate {
  index: number;
  text: string;
  sectionHeading: string | null;
  needsDate: boolean;
  needsPerson: boolean;
}

interface NamedEntity {
  id: string;
  name: string;
}

/**
 * Run-scoped working state for one `extract` call. Passed to each phase method
 * so no phase needs 4+ positional parameters and no request-scoped data lives
 * in module-level mutables.
 */
interface ExtractionRun {
  note: ParsedNote;
  context: ExtractionContext;
  checkboxes: ParsedCheckbox[];
  enriched: EnrichedCheckbox[];
  matched: TaskMatch[];
  unmatchedCheckboxIndices: number[];
  unmatchedTaskIds: string[];
  uniqueProjects: NamedEntity[];
  uniquePeople: NamedEntity[];
  referenceDate: Date;
  userTimeZone: string;
  taskIdByCheckboxIndex: Map<number, string>;
  parentLinkWritten: Set<number>;
  allTaskIds: string[];
  errors: string[];
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

// ---------------------------------------------------------------------------
// TaskExtractor
// ---------------------------------------------------------------------------

export class TaskExtractor implements Extractor {
  readonly referenceKey = REFERENCE_KEYS.tasks;

  async extract(
    note: ParsedNote,
    context: ExtractionContext,
  ): Promise<ExtractionResult> {
    if (note.checkboxes.length === 0) {
      return { referenceKey: this.referenceKey, ids: [] };
    }

    const run = this.createRun(note, context);
    await this.resolveProjects(run);
    await this.enrichDatesAndAssignments(run);
    await this.updateMatchedTasks(run);
    await this.createNewTasks(run);
    await this.fixParentLinks(run);
    await this.archiveRemovedTasks(run);

    return {
      referenceKey: this.referenceKey,
      ids: run.allTaskIds,
      ...(run.errors.length > 0 ? { errors: run.errors } : {}),
    };
  }

  /** Reconciles against known tasks and builds the run-scoped working state. */
  private createRun(
    note: ParsedNote,
    context: ExtractionContext,
  ): ExtractionRun {
    const checkboxes = note.checkboxes;
    const { matched, unmatchedCheckboxIndices, unmatchedTaskIds } =
      reconcileCheckboxes(checkboxes, context.knownTasks);

    return {
      note,
      context,
      checkboxes,
      // `content` defaults to the raw checkbox text; fast paths overwrite it.
      enriched: checkboxes.map((checkbox, index) => ({
        index,
        content: checkbox.text,
        projectId: null,
        dueDate: null,
        assignedTo: null,
        projectUnavailable: false,
        dateUnavailable: false,
        personUnavailable: false,
      })),
      matched,
      unmatchedCheckboxIndices,
      unmatchedTaskIds,
      uniqueProjects: dedupeById([
        ...context.knownProjects,
        ...context.newlyCreatedProjects,
      ]),
      uniquePeople: dedupeById([
        ...context.knownPeople,
        ...context.newlyCreatedPeople,
      ]),
      // Relative dates resolve against this instant in the configured user
      // timezone (default UTC), not the server's UTC clock (Step 9 / C7).
      referenceDate: new Date(),
      userTimeZone: getConfiguredTimeZone(),
      taskIdByCheckboxIndex: new Map(),
      parentLinkWritten: new Set(),
      allTaskIds: [],
      errors: [], // Write failures surfaced, not swallowed (C6 / Step 8).
    };
  }

  /**
   * Phase 1 — resolve each checkbox's project via the priority chain
   * (heading > pipeline reference > AI inference). A checkbox that needed AI
   * inference but stayed unresolved is marked `projectUnavailable` only when
   * the inference call did NOT run (error / no projects), so an outage can
   * never null an existing association.
   */
  private async resolveProjects(run: ExtractionRun): Promise<void> {
    const pipelineProjectIds =
      run.context.accumulatedReferences[REFERENCE_KEYS.projects] || [];
    const unassignedForAI: AiCandidate[] = [];

    for (let index = 0; index < run.checkboxes.length; index++) {
      const headingProjectId = matchProjectByHeading(
        run.checkboxes[index],
        run.uniqueProjects,
      );
      if (headingProjectId) {
        run.enriched[index].projectId = headingProjectId;
      } else if (pipelineProjectIds.length > 0) {
        run.enriched[index].projectId = pipelineProjectIds[0];
      } else {
        unassignedForAI.push({
          index,
          text: run.checkboxes[index].text,
          sectionHeading: null,
          needsDate: false,
          needsPerson: false,
        });
      }
    }

    const inferenceRan = await this.inferProjects(run, unassignedForAI);
    for (const candidate of unassignedForAI) {
      if (run.enriched[candidate.index].projectId === null && !inferenceRan) {
        run.enriched[candidate.index].projectUnavailable = true;
      }
    }
  }

  /** Runs LLM project inference for unassigned checkboxes; returns whether it ran. */
  private async inferProjects(
    run: ExtractionRun,
    unassignedForAI: AiCandidate[],
  ): Promise<boolean> {
    if (unassignedForAI.length === 0 || run.uniqueProjects.length === 0) {
      return false;
    }
    const { ok, assignments } = await inferProjectsByContent(
      unassignedForAI.map((candidate) => ({
        index: candidate.index,
        text: candidate.text,
      })),
      run.uniqueProjects,
      run.context.aiProvider,
    );
    if (!ok) return false;
    for (const assignment of assignments) {
      run.enriched[assignment.taskIndex].projectId = assignment.projectId;
    }
    return true;
  }

  /**
   * Phase 1b — extract dates, assignees, and cleaned content per checkbox via
   * fast paths, then a single batched LLM enrichment for whatever remains.
   */
  private async enrichDatesAndAssignments(run: ExtractionRun): Promise<void> {
    const aiCandidates = this.resolveFastPaths(run);
    const enrichmentRan = await this.applyAiEnrichment(run, aiCandidates);

    for (const candidate of aiCandidates) {
      const state = run.enriched[candidate.index];
      if (candidate.needsDate && state.dueDate === null && !enrichmentRan) {
        state.dateUnavailable = true;
      }
      if (
        candidate.needsPerson && state.assignedTo === null && !enrichmentRan
      ) {
        state.personUnavailable = true;
      }
    }
  }

  /** Regex date + explicit/substring/heading person fast paths; queues the rest. */
  private resolveFastPaths(run: ExtractionRun): AiCandidate[] {
    const aiCandidates: AiCandidate[] = [];
    for (let index = 0; index < run.checkboxes.length; index++) {
      const checkbox = run.checkboxes[index];
      const state = run.enriched[index];
      let text = checkbox.text;
      let needsDate = true;
      let needsPerson = true;

      const dateResult = extractDueDate(
        text,
        run.referenceDate,
        run.userTimeZone,
      );
      if (dateResult.dueDate) {
        state.dueDate = dateResult.dueDate;
        text = dateResult.cleanedText;
        needsDate = false;
      }

      const person = this.resolveFastPathPerson(
        text,
        checkbox,
        run.uniquePeople,
      );
      if (person.personId) {
        state.assignedTo = person.personId;
        text = person.cleanedText;
        needsPerson = false;
      }

      state.content = cleanStrippedText(text);
      if (needsDate || needsPerson) {
        aiCandidates.push({
          index,
          text: checkbox.text, // original text for AI context
          sectionHeading: checkbox.sectionHeading,
          needsDate,
          needsPerson,
        });
      }
    }
    return aiCandidates;
  }

  /**
   * Person fast paths, in priority order: explicit "(assigned: X)"/"(owner: X)"
   * marker (which strips the marker from content), then name substring in the
   * checkbox text, then name in the section heading (neither strips).
   */
  private resolveFastPathPerson(
    text: string,
    checkbox: ParsedCheckbox,
    uniquePeople: NamedEntity[],
  ): { personId: string | null; cleanedText: string } {
    const assignResult = extractAssignment(text, uniquePeople);
    if (assignResult.personId) return assignResult;

    const substringMatch = findPersonInText(text, uniquePeople);
    if (substringMatch) return { personId: substringMatch, cleanedText: text };

    if (checkbox.sectionHeading) {
      const headingMatch = findPersonInText(
        checkbox.sectionHeading,
        uniquePeople,
      );
      if (headingMatch) return { personId: headingMatch, cleanedText: text };
    }
    return { personId: null, cleanedText: text };
  }

  /** Single batched LLM call for unresolved dates/assignees; returns whether it ran. */
  private async applyAiEnrichment(
    run: ExtractionRun,
    aiCandidates: AiCandidate[],
  ): Promise<boolean> {
    const shouldCall = aiCandidates.length > 0 &&
      (run.uniquePeople.length > 0 ||
        aiCandidates.some((candidate) =>
          run.enriched[candidate.index].dueDate === null
        ));
    if (!shouldCall) return false;

    const { ok, enrichments } = await inferTaskEnrichments(
      aiCandidates,
      run.uniquePeople,
      run.context.aiProvider,
      run.referenceDate,
      run.userTimeZone,
    );
    if (!ok) return false;

    for (const enrichment of enrichments) {
      const state = run.enriched[enrichment.taskIndex];
      if (!state) continue; // ignore any hallucinated out-of-range index
      // Only fill fields not already resolved by a fast path.
      const resolvedDate = state.dueDate === null && enrichment.dueDate;
      const resolvedPerson = state.assignedTo === null &&
        enrichment.assignedToId;
      if (resolvedDate) state.dueDate = enrichment.dueDate;
      if (resolvedPerson) state.assignedTo = enrichment.assignedToId;
      // Only adopt AI-cleaned text when the AI actually resolved something —
      // otherwise stripping markers would lose info stored nowhere.
      if ((resolvedDate || resolvedPerson) && enrichment.cleanedText) {
        state.content = cleanStrippedText(enrichment.cleanedText);
      }
    }
    return true;
  }

  /**
   * Phase 2 — update matched (existing) tasks. The parent-link write is folded
   * in here whenever the parent id is already known, avoiding the redundant
   * second update; parents that resolve only after new-task creation are left
   * to `fixParentLinks`.
   */
  private async updateMatchedTasks(run: ExtractionRun): Promise<void> {
    for (const match of run.matched) {
      const checkbox = run.checkboxes[match.checkboxIndex];
      const state = run.enriched[match.checkboxIndex];
      const newStatus = checkbox.checked ? "done" : "open";

      const updates: Record<string, unknown> = {
        content: state.content,
        status: newStatus,
        metadata: buildTaskMetadata(run.note.source, checkbox.sectionHeading),
        archived_at: newStatus === "done" ? new Date().toISOString() : null,
      };
      // Merge policy: set when resolved, clear when resolved-empty, preserve
      // (omit) when unavailable. Same rule for all three fields.
      applyMergeField(
        updates,
        "project_id",
        state.projectId,
        state.projectUnavailable,
      );
      applyMergeField(
        updates,
        "assigned_to",
        state.assignedTo,
        state.personUnavailable,
      );
      applyMergeField(updates, "due_by", state.dueDate, state.dateUnavailable);

      if (checkbox.parentIndex !== null) {
        const parentId = run.taskIdByCheckboxIndex.get(checkbox.parentIndex);
        if (parentId !== undefined) {
          updates.parent_id = parentId;
          run.parentLinkWritten.add(match.checkboxIndex);
        }
      }

      const { error } = await run.context.taskRepository.update(
        match.existingTaskId,
        updates,
      );
      if (error) {
        run.errors.push(
          `Failed to update task ${match.existingTaskId}: ${error.message}`,
        );
      }

      run.taskIdByCheckboxIndex.set(match.checkboxIndex, match.existingTaskId);
      run.allTaskIds.push(match.existingTaskId);
    }
  }

  /** Phase 3 — create new tasks for unmatched checkboxes. */
  private async createNewTasks(run: ExtractionRun): Promise<void> {
    for (const checkboxIndex of run.unmatchedCheckboxIndices) {
      const checkbox = run.checkboxes[checkboxIndex];
      const state = run.enriched[checkboxIndex];
      const status = checkbox.checked ? "done" : "open";
      const parentId = checkbox.parentIndex !== null
        ? run.taskIdByCheckboxIndex.get(checkbox.parentIndex) ?? null
        : null;

      const insertData: NewTaskValues = {
        content: state.content,
        status,
        reference_id: run.note.referenceId,
        project_id: state.projectId,
        parent_id: parentId,
        metadata: buildTaskMetadata(run.note.source, checkbox.sectionHeading),
      };
      if (state.assignedTo) insertData.assigned_to = state.assignedTo;
      if (state.dueDate) insertData.due_by = state.dueDate;
      if (status === "done") insertData.archived_at = new Date().toISOString();

      const { data: newTask, error } = await run.context.taskRepository.insert(
        insertData,
      );
      if (!error && newTask) {
        run.taskIdByCheckboxIndex.set(checkboxIndex, newTask.id);
        run.allTaskIds.push(newTask.id);
        run.context.newlyCreatedTasks.push({
          id: newTask.id,
          content: newTask.content,
        });
      } else {
        run.errors.push(
          `Failed to create task for "${checkbox.text}": ${
            error?.message ?? "unknown error"
          }`,
        );
      }
    }
  }

  /**
   * Phase 4 — set parent_id for matched tasks whose link was not already folded
   * into the Phase 2 update (parent was a task created in Phase 3).
   */
  private async fixParentLinks(run: ExtractionRun): Promise<void> {
    for (const match of run.matched) {
      if (run.parentLinkWritten.has(match.checkboxIndex)) continue;
      const checkbox = run.checkboxes[match.checkboxIndex];
      if (checkbox.parentIndex === null) continue;

      const parentId = run.taskIdByCheckboxIndex.get(checkbox.parentIndex) ??
        null;
      const { error } = await run.context.taskRepository.update(
        match.existingTaskId,
        { parent_id: parentId },
      );
      if (error) {
        run.errors.push(
          `Failed to update parent_id for task ${match.existingTaskId}: ${error.message}`,
        );
      }
    }
  }

  /** Phase 5 — archive tasks whose checkboxes were removed from the note. */
  private async archiveRemovedTasks(run: ExtractionRun): Promise<void> {
    for (const taskId of run.unmatchedTaskIds) {
      // Only archive if not already archived (guarded in the repository).
      const { error } = await run.context.taskRepository.archiveIfActive(
        taskId,
      );
      if (error) {
        run.errors.push(`Failed to archive task ${taskId}: ${error.message}`);
      }
    }
  }
}
