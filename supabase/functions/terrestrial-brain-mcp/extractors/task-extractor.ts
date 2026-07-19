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
 *
 * Split into cohesive modules (EXTR-12): similarity scoring lives in
 * similarity.ts, checkbox↔task matching in task-reconciliation.ts, and the LLM
 * inference calls in task-inference.ts. This file keeps the extractor class and
 * the re-ingest merge policy, and re-exports the moved symbols so existing
 * import paths keep working.
 */

import type { ParsedCheckbox, ParsedNote } from "../parser.ts";
import type {
  ExtractionContext,
  ExtractionResult,
  Extractor,
  KnownProject,
} from "./pipeline.ts";
import { REFERENCE_KEYS } from "./pipeline.ts";
import type { KnownPerson } from "./name-matching.ts";
import { cleanStrippedText, extractDueDate } from "./date-parser.ts";
import { findPersonByName, findPersonInText } from "./name-matching.ts";
import { ASSIGNMENT_MARKER_PATTERN } from "./markers.ts";
import type {
  NewTaskValues,
  TaskUpdate,
} from "../repositories/task-repository.ts";
import { hashContent } from "../helpers.ts";
import { reconcileCheckboxes, type TaskMatch } from "./task-reconciliation.ts";
import {
  inferProjectsByContent,
  inferTaskEnrichments,
} from "./task-inference.ts";

// Re-exports for the symbols moved out in the EXTR-12 split, so existing
// imports of this module keep working unchanged.
export { computeSimilarity } from "./similarity.ts";
export {
  greedyMatch,
  reconcileCheckboxesForTest,
  type ScoredPair,
  stripMarkersForComparison,
} from "./task-reconciliation.ts";

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
  updates: TaskUpdate,
  column: "project_id" | "assigned_to" | "due_by",
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
 * Strips the pattern from content if person is found. Matching uses the shared
 * tiered matcher (EXTR-3): exact full name wins, then a name-part match only
 * when unambiguous — never first-in-list substring containment, so "Bo" can't
 * silently land on "Bob Smith". Ambiguous candidates fall through (personId
 * null, marker left intact) to the AI path, which has heading context.
 */
export function extractAssignment(
  text: string,
  knownPeople: KnownPerson[],
): { personId: string | null; cleanedText: string } {
  if (knownPeople.length === 0) return { personId: null, cleanedText: text };

  const match = text.match(ASSIGNMENT_PATTERN);
  if (!match) return { personId: null, cleanedText: text };

  const personId = findPersonByName(match[1], knownPeople);
  if (personId) {
    return {
      personId,
      cleanedText: cleanStrippedText(text.replace(match[0], "")),
    };
  }

  return { personId: null, cleanedText: text };
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
      // The timezone is injected through the pipeline deps (EXTR-11), never
      // read from env mid-extraction.
      referenceDate: new Date(),
      userTimeZone: context.timeZone,
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
    const { ran, respondedIndexes } = await this.applyAiEnrichment(
      run,
      aiCandidates,
    );

    for (const candidate of aiCandidates) {
      const state = run.enriched[candidate.index];
      // A field is "unavailable" (→ preserve stored value) when enrichment did
      // not run OR the response carried NO entry for this task (EXTR-4): an
      // absent entry — e.g. a truncated completion — is not an affirmative
      // "nothing found". Only an entry present with explicit nulls clears.
      const entryAbsent = !ran || !respondedIndexes.has(candidate.index);
      if (candidate.needsDate && state.dueDate === null && entryAbsent) {
        state.dateUnavailable = true;
      }
      if (
        candidate.needsPerson && state.assignedTo === null && entryAbsent
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
  ): Promise<{ ran: boolean; respondedIndexes: Set<number> }> {
    const shouldCall = aiCandidates.length > 0 &&
      (run.uniquePeople.length > 0 ||
        aiCandidates.some((candidate) =>
          run.enriched[candidate.index].dueDate === null
        ));
    if (!shouldCall) return { ran: false, respondedIndexes: new Set() };

    const { ok, enrichments } = await inferTaskEnrichments(
      aiCandidates,
      run.uniquePeople,
      run.context.aiProvider,
      run.referenceDate,
      run.userTimeZone,
    );
    if (!ok) return { ran: false, respondedIndexes: new Set() };

    // The indexes the model actually answered for — an omitted task must be
    // treated as unresolved, not as "clear the stored value" (EXTR-4).
    const respondedIndexes = new Set(
      enrichments.map((enrichment) => enrichment.taskIndex),
    );

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
    return { ran: true, respondedIndexes };
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

      // Schema-typed payload (REPO-4): a misspelled column is a compile error.
      const updates: TaskUpdate = {
        content: state.content,
        // INVARIANT 1: re-hash on every content edit (the extractor is part of
        // the one server-side update path). A stale hash is worse than none —
        // the dedup gate would compare against text the row no longer holds.
        content_hash: await hashContent(state.content),
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
        // INVARIANT 1: stamp content_hash on create (the one update path).
        content_hash: await hashContent(state.content),
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
