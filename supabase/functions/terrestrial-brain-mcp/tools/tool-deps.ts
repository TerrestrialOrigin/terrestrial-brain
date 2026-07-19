/**
 * Shared dependency surface for the tool modules (CORE-7 / TOOL-11 / TOOL-14).
 *
 * The composition root (`index.ts`) builds every seam exactly once and hands
 * each `register*` function a `Pick<ToolDeps, …>` of just the fields it uses.
 * Named fields make transposing two same-typed repositories a compile-time
 * error, and adding a dependency is a one-field change instead of an edit to
 * every positional call chain.
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import type { FunctionCallLogger } from "../logger.ts";
import type { AiProvider } from "../ai/ai-provider.ts";
import type { AiQuotaGate } from "../ai-quota.ts";
import type { ThoughtRepository } from "../repositories/thought-repository.ts";
import type { TaskRepository } from "../repositories/task-repository.ts";
import type { ProjectRepository } from "../repositories/project-repository.ts";
import type { PersonRepository } from "../repositories/person-repository.ts";
import type { DocumentRepository } from "../repositories/document-repository.ts";
import type { AiOutputRepository } from "../repositories/ai-output-repository.ts";
import type { NoteSnapshotRepository } from "../repositories/note-snapshot-repository.ts";
import type { ArchiveMaintenanceRepository } from "../repositories/archive-maintenance-repository.ts";
import type { QueryRepository } from "../repositories/query-repository.ts";
import type { Extractor } from "../extractors/pipeline.ts";

export interface ToolDeps {
  supabase: AppSupabaseClient;
  logger: FunctionCallLogger;
  aiProvider: AiProvider;
  quotaGate: AiQuotaGate;
  thoughtRepository: ThoughtRepository;
  taskRepository: TaskRepository;
  projectRepository: ProjectRepository;
  personRepository: PersonRepository;
  documentRepository: DocumentRepository;
  aiOutputRepository: AiOutputRepository;
  noteSnapshotRepository: NoteSnapshotRepository;
  archiveMaintenanceRepository: ArchiveMaintenanceRepository;
  queryRepository: QueryRepository;
  /** The ordered extractor set, built once at the composition root (TOOL-14). */
  extractors: Extractor[];
  /** Configured user timezone, read once at the composition root (EXTR-11). */
  timeZone: string;
}
