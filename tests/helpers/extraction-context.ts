// Shared ExtractionContext factory (TEST-13).
//
// Every test that needs an ExtractionContext builds it here instead of
// hand-writing the full 12-field literal. The four external seams (AI provider
// and the three repositories) are REQUIRED parameters — the factory stays pure
// and works for both integration tests (real Supabase-backed repositories) and
// unit tests (fakes). Everything else defaults to the empty/neutral value and
// is overridden per test only where that test cares.

import type { AiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";
import type { TaskRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/task-repository.ts";
import type { ProjectRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/project-repository.ts";
import type { PersonRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/person-repository.ts";
import type { ExtractionContext } from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";

/** The injected seams a context always needs — supplied explicitly by the caller. */
export interface ExtractionContextDeps {
  aiProvider: AiProvider;
  taskRepository: TaskRepository;
  projectRepository: ProjectRepository;
  personRepository: PersonRepository;
}

/**
 * Builds a complete ExtractionContext from the given seams plus sensible
 * defaults (empty known/created collections, `timeZone: "UTC"`), applying any
 * per-test overrides last.
 */
export function makeExtractionContext(
  deps: ExtractionContextDeps,
  overrides: Partial<ExtractionContext> = {},
): ExtractionContext {
  return {
    aiProvider: deps.aiProvider,
    taskRepository: deps.taskRepository,
    projectRepository: deps.projectRepository,
    personRepository: deps.personRepository,
    timeZone: "UTC",
    knownProjects: [],
    knownTasks: [],
    knownPeople: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
    newlyCreatedPeople: [],
    accumulatedReferences: {},
    ...overrides,
  };
}
