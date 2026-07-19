/**
 * Extractor pipeline framework.
 *
 * Defines the Extractor interface, ExtractionContext, and the pipeline
 * runner that orchestrates sequential extraction from parsed notes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedNote } from "../parser.ts";
import type { AiProvider } from "../ai/ai-provider.ts";
import type { TaskRepository } from "../repositories/task-repository.ts";
import type { ProjectRepository } from "../repositories/project-repository.ts";
import type { PersonRepository } from "../repositories/person-repository.ts";
import type { KnownPerson } from "./name-matching.ts";
import { ProjectExtractor } from "./project-extractor.ts";
import { PeopleExtractor } from "./people-extractor.ts";
import { TaskExtractor } from "./task-extractor.ts";

// ---------------------------------------------------------------------------
// Reference keys
// ---------------------------------------------------------------------------

/**
 * Canonical reference-key names shared by every extractor. Each extractor's
 * `referenceKey` and every cross-extractor read of `accumulatedReferences`
 * (e.g. TaskExtractor consuming the projects list) sources its key here, so a
 * rename is a single edit and the coupling is greppable rather than a bare
 * string literal.
 */
export const REFERENCE_KEYS = {
  projects: "projects",
  tasks: "tasks",
  people: "people",
} as const;

export type ReferenceKey = typeof REFERENCE_KEYS[keyof typeof REFERENCE_KEYS];

// ---------------------------------------------------------------------------
// Shared entity types
// ---------------------------------------------------------------------------

/** A known/known-created project the extractors reason over. */
export type KnownProject = { id: string; name: string };

/** An existing task (with its note reference) used for reconciliation. */
export type KnownTask = {
  id: string;
  content: string;
  reference_id: string | null;
};

/** A task just created in this pipeline run — no reference_id needed. */
export type NewTaskRef = { id: string; content: string };

export type { KnownPerson };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionContext {
  supabase: SupabaseClient;
  /** Injected LLM/embedding seam — extractors call this instead of fetch. */
  aiProvider: AiProvider;
  /** Injected tasks-table seam — TaskExtractor writes through this, not supabase. */
  taskRepository: TaskRepository;
  /** Injected projects-table seam — ProjectExtractor writes through this. */
  projectRepository: ProjectRepository;
  /** Injected people-table seam — PeopleExtractor writes through this. */
  personRepository: PersonRepository;
  knownProjects: KnownProject[];
  knownTasks: KnownTask[];
  knownPeople: KnownPerson[];
  newlyCreatedProjects: KnownProject[];
  newlyCreatedTasks: NewTaskRef[];
  newlyCreatedPeople: KnownPerson[];
  /** References accumulated by previously-run extractors in the pipeline. */
  accumulatedReferences: Record<string, string[]>;
}

export interface ExtractionResult {
  referenceKey: string;
  ids: string[];
  /**
   * Human-readable messages for writes that failed during extraction. Absent
   * or empty when every write succeeded. Surfaced (not swallowed) so callers
   * and the pipeline runner can report partial failure instead of reporting
   * success. See finding C6 / fix-plan Step 8.
   */
  errors?: string[];
}

/**
 * An extractor detects a class of references (projects, tasks, or people) in a
 * parsed note.
 *
 * **Ordering is significant.** Extractors run in the fixed order given to
 * `runExtractionPipeline` (see `createDefaultExtractors`), and a later extractor
 * MAY depend on the references an earlier one produced: `TaskExtractor` reads the
 * project ids `ProjectExtractor` accumulated (`context.accumulatedReferences`),
 * so ProjectExtractor MUST run before it.
 *
 * **`extract` has side effects (detect + mutate + enrich).** Despite returning
 * an `ExtractionResult`, `extract` also WRITES to the database (auto-creating
 * projects/people, updating/creating/archiving tasks) and enriches the shared
 * `context` for downstream extractors. A mid-pipeline failure can therefore
 * leave partial writes; such failures are reported via `ExtractionResult.errors`
 * and surfaced by the runner rather than swallowed.
 */
export interface Extractor {
  readonly referenceKey: string;
  extract(
    note: ParsedNote,
    context: ExtractionContext,
  ): Promise<ExtractionResult>;
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

/**
 * Discriminated outcome of an extraction run.
 *
 * `ok: false` means a SEED read (known projects/people, or the note's existing
 * tasks) failed. Proceeding with an empty seed is never safe — it silently turns
 * a transient read failure into duplicate writes (every checkbox re-created,
 * duplicate projects auto-created) — so the runner aborts BEFORE running any
 * extractor and the caller must surface an error instead of ingesting (EXTR-2).
 *
 * `ok: true` carries the reference map plus any non-fatal per-write failures the
 * extractors reported (`errors`), so callers can report partial failure rather
 * than claiming full success (EXTR-6).
 */
export interface PipelineSuccess {
  ok: true;
  references: Record<string, string[]>;
  errors: string[];
}

export interface PipelineFailure {
  ok: false;
  error: string;
}

export type PipelineOutcome = PipelineSuccess | PipelineFailure;

/**
 * Formats a caller-facing suffix describing partial extraction failures, so a
 * tool response reports "some reference writes failed" instead of claiming full
 * success (EXTR-6). Returns "" when there are no errors.
 */
export function partialExtractionWarning(errors: string[]): string {
  if (errors.length === 0) return "";
  return ` (warning: ${errors.length} reference write(s) failed: ${
    errors.join("; ")
  })`;
}

/**
 * Runs extractors sequentially against a parsed note, collecting results
 * into a reference map. Each extractor may enrich the shared context for
 * downstream extractors.
 */
export async function runExtractionPipeline(
  note: ParsedNote,
  extractors: Extractor[],
  supabase: SupabaseClient,
  aiProvider: AiProvider,
  taskRepository: TaskRepository,
  projectRepository: ProjectRepository,
  personRepository: PersonRepository,
): Promise<PipelineOutcome> {
  // Initialize context — fetch known projects and people through the repos.
  const [activeProjectsResult, activePeopleResult] = await Promise.all([
    projectRepository.listActive(),
    personRepository.listActive(),
  ]);
  const activeProjects = activeProjectsResult.data;
  const activePeople = activePeopleResult.data;

  // Abort on a failed seed read: an empty seed silently becomes duplicate
  // writes, so a read failure must NOT degrade into "genuinely new" (EXTR-2).
  if (activeProjectsResult.error) {
    return {
      ok: false,
      error:
        `Could not read active projects: ${activeProjectsResult.error.message}`,
    };
  }
  if (activePeopleResult.error) {
    return {
      ok: false,
      error:
        `Could not read active people: ${activePeopleResult.error.message}`,
    };
  }

  // Fetch known tasks for this note's reference_id (for reconciliation)
  let knownTasks: {
    id: string;
    content: string;
    reference_id: string | null;
  }[] = [];
  if (note.referenceId) {
    const { data: existingTasks, error: tasksError } = await taskRepository
      .findByReference(note.referenceId);
    if (tasksError) {
      return {
        ok: false,
        error:
          `Could not read existing tasks for "${note.referenceId}": ${tasksError.message}`,
      };
    }
    knownTasks = (existingTasks || []).map(
      (task: { id: string; content: string; reference_id: string | null }) => ({
        id: task.id,
        content: task.content,
        reference_id: task.reference_id,
      }),
    );
  }

  const context: ExtractionContext = {
    supabase,
    aiProvider,
    taskRepository,
    projectRepository,
    personRepository,
    knownProjects: (activeProjects || []).map(
      (project: { id: string; name: string }) => ({
        id: project.id,
        name: project.name,
      }),
    ),
    knownTasks,
    knownPeople: (activePeople || []).map(
      (person: { id: string; name: string }) => ({
        id: person.id,
        name: person.name,
      }),
    ),
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
  };

  // Run each extractor sequentially, collecting results
  const references: Record<string, string[]> = {};
  const collectedErrors: string[] = [];

  for (const extractor of extractors) {
    const result = await extractor.extract(note, context);
    references[result.referenceKey] = result.ids;
    // Surface (don't swallow) any write failures the extractor reported:
    // both logged AND returned so the caller can report partial failure.
    if (result.errors && result.errors.length > 0) {
      collectedErrors.push(...result.errors);
      console.error(
        `Extractor "${result.referenceKey}" reported ${result.errors.length} write failure(s): ${
          result.errors.join("; ")
        }`,
      );
    }
    context.accumulatedReferences = { ...references };
  }

  return { ok: true, references, errors: collectedErrors };
}

/**
 * Element-level guard for LLM response parsing (EXTR-8): callbacks check each
 * array element with this before touching properties, so one malformed element
 * (e.g. a literal null) is skipped instead of throwing and poisoning the batch.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ---------------------------------------------------------------------------
// Shared tool-facing wrapper
// ---------------------------------------------------------------------------

/** The repository/provider seams the extraction pipeline runs against. */
export interface ToolExtractionDeps {
  supabase: SupabaseClient;
  aiProvider: AiProvider;
  taskRepository: TaskRepository;
  projectRepository: ProjectRepository;
  personRepository: PersonRepository;
}

/**
 * Outcome of `runExtractionForTool`. `aborted` mirrors `PipelineFailure` (a
 * seed read failed — the caller must refuse the operation, EXTR-2). `completed`
 * always carries a reference map plus a caller-visible `warning` suffix: empty
 * on clean success, the partial-failure text when extractor writes failed
 * (EXTR-6), or the extraction-failed text when the pipeline threw (TOOL-12).
 */
export type ToolExtractionRun =
  | { status: "aborted"; reason: string }
  | {
    status: "completed";
    references: Record<string, string[]>;
    warning: string;
  };

/**
 * Caller-visible warning appended to a tool confirmation when the extraction
 * pipeline threw (as opposed to reporting per-write errors): the operation
 * succeeded but reference extraction did not run to completion.
 */
export const EXTRACTION_THREW_WARNING =
  " (warning: reference extraction failed — references not recorded)";

/**
 * Runs the extraction pipeline on behalf of a tool handler, folding the three
 * possible outcomes (seed-read abort / completed with per-write errors / thrown
 * pipeline) into one discriminated result so the four ingest-shaped handlers
 * share a single copy of the try/abort/warn logic instead of four drifting
 * ones (TOOL-12, Rule of Three).
 *
 * `parse` runs inside the try so a parser throw degrades the same way a
 * pipeline throw does. `runPipeline` is injectable for unit tests only.
 */
export async function runExtractionForTool(options: {
  parse: () => ParsedNote;
  deps: ToolExtractionDeps;
  /** Context label for the console.error line when the pipeline throws. */
  site: string;
  /** References to report when the pipeline threw (site-specific fallback). */
  thrownReferences?: Record<string, string[]>;
  /** Site-specific wording override for the thrown-pipeline warning. */
  thrownWarning?: string;
  extractors?: Extractor[];
  runPipeline?: typeof runExtractionPipeline;
}): Promise<ToolExtractionRun> {
  const {
    parse,
    deps,
    site,
    thrownReferences = {},
    thrownWarning = EXTRACTION_THREW_WARNING,
    extractors = createDefaultExtractors(),
    runPipeline = runExtractionPipeline,
  } = options;
  try {
    const note = parse();
    const outcome = await runPipeline(
      note,
      extractors,
      deps.supabase,
      deps.aiProvider,
      deps.taskRepository,
      deps.projectRepository,
      deps.personRepository,
    );
    if (!outcome.ok) {
      return { status: "aborted", reason: outcome.error };
    }
    return {
      status: "completed",
      references: outcome.references,
      warning: partialExtractionWarning(outcome.errors),
    };
  } catch (pipelineError) {
    const message = pipelineError instanceof Error
      ? pipelineError.message
      : String(pipelineError);
    console.error(`${site} extraction pipeline error: ${message}`);
    // The operation proceeds, but the caller-visible warning makes the dropped
    // references observable instead of reading as full success (TOOL-12).
    return {
      status: "completed",
      references: thrownReferences,
      warning: thrownWarning,
    };
  }
}

// ---------------------------------------------------------------------------
// Default extractor factory
// ---------------------------------------------------------------------------

/**
 * Returns the standard ordered extractor sequence. Ordering is load-bearing —
 * ProjectExtractor runs before TaskExtractor so the latter can consume the
 * project references the former accumulates (see the `Extractor` contract).
 *
 * A fresh array is returned on every call so callers can never share (and
 * accidentally mutate) a common instance.
 */
export function createDefaultExtractors(): Extractor[] {
  return [
    new ProjectExtractor(),
    new PeopleExtractor(),
    new TaskExtractor(),
  ];
}
