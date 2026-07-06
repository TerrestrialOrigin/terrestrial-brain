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
): Promise<Record<string, string[]>> {
  // Initialize context — fetch known projects and people through the repos
  const [{ data: activeProjects }, { data: activePeople }] = await Promise.all([
    projectRepository.listActive(),
    personRepository.listActive(),
  ]);

  // Fetch known tasks for this note's reference_id (for reconciliation)
  let knownTasks: {
    id: string;
    content: string;
    reference_id: string | null;
  }[] = [];
  if (note.referenceId) {
    const { data: existingTasks } = await taskRepository.findByReference(
      note.referenceId,
    );
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

  for (const extractor of extractors) {
    const result = await extractor.extract(note, context);
    references[result.referenceKey] = result.ids;
    // Surface (don't swallow) any write failures the extractor reported.
    if (result.errors && result.errors.length > 0) {
      console.error(
        `Extractor "${result.referenceKey}" reported ${result.errors.length} write failure(s): ${
          result.errors.join("; ")
        }`,
      );
    }
    context.accumulatedReferences = { ...references };
  }

  return references;
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
