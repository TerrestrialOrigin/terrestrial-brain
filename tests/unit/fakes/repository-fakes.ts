import type { ThoughtRepository } from "../../../supabase/functions/terrestrial-brain-mcp/repositories/thought-repository.ts";
import type { TaskRepository } from "../../../supabase/functions/terrestrial-brain-mcp/repositories/task-repository.ts";
import type { ProjectRepository } from "../../../supabase/functions/terrestrial-brain-mcp/repositories/project-repository.ts";
import type { PersonRepository } from "../../../supabase/functions/terrestrial-brain-mcp/repositories/person-repository.ts";
import type { AiOutputRepository } from "../../../supabase/functions/terrestrial-brain-mcp/repositories/ai-output-repository.ts";
import type { NoteSnapshotRepository } from "../../../supabase/functions/terrestrial-brain-mcp/repositories/note-snapshot-repository.ts";

// Shared repository fakes for unit tests (Rule of Three — previously copied
// into every spec that needed one). Every method defaults to a loud rejection
// so a test exercising an unexpected path fails immediately; override exactly
// the methods your test drives.

export const notImpl = () => Promise.reject(new Error("not implemented"));

export function fakeThoughtRepository(
  overrides: Partial<ThoughtRepository> = {},
): ThoughtRepository {
  return {
    matchByEmbedding: notImpl,
    list: notImpl,
    stats: notImpl,
    findById: notImpl,
    findForUpdate: notImpl,
    findActiveById: notImpl,
    findByReference: notImpl,
    findByContentHash: notImpl,
    findStale: notImpl,
    findArchivalCandidates: notImpl,
    setSupersededBy: notImpl,
    touchRetrieved: notImpl,
    insert: notImpl,
    update: notImpl,
    archive: notImpl,
    archiveByDocumentReference: notImpl,
    incrementUsefulness: notImpl,
    incrementUsefulnessWeighted: notImpl,
    deleteByNoteSnapshot: notImpl,
    ...overrides,
  };
}

export function fakeTaskRepository(
  overrides: Partial<TaskRepository> = {},
): TaskRepository {
  return {
    insert: notImpl,
    list: notImpl,
    listIncompleteUnarchived: notImpl,
    findByIds: notImpl,
    update: notImpl,
    archive: notImpl,
    archiveIfActive: notImpl,
    countOpenByProject: notImpl,
    countOpenByAssignee: notImpl,
    findOpenIdsByProjects: notImpl,
    archiveMany: notImpl,
    deleteByIds: notImpl,
    findByReference: notImpl,
    ...overrides,
  };
}

export function fakeProjectRepository(
  overrides: Partial<ProjectRepository> = {},
): ProjectRepository {
  return {
    insert: notImpl,
    list: notImpl,
    findById: notImpl,
    findName: notImpl,
    findByName: notImpl,
    listChildrenBasic: notImpl,
    listChildParentIds: notImpl,
    listActiveChildIds: notImpl,
    update: notImpl,
    archiveManyActive: notImpl,
    listActive: notImpl,
    ...overrides,
  };
}

export function fakePersonRepository(
  overrides: Partial<PersonRepository> = {},
): PersonRepository {
  return {
    insert: notImpl,
    list: notImpl,
    findById: notImpl,
    findName: notImpl,
    findByName: notImpl,
    update: notImpl,
    archive: notImpl,
    listActive: notImpl,
    ...overrides,
  };
}

export function fakeAiOutputRepository(
  overrides: Partial<AiOutputRepository> = {},
): AiOutputRepository {
  return {
    insert: notImpl,
    listPending: notImpl,
    listPendingMetadata: notImpl,
    findContentByIds: notImpl,
    markPickedUp: notImpl,
    reject: notImpl,
    ...overrides,
  };
}

export function fakeNoteSnapshotRepository(
  overrides: Partial<NoteSnapshotRepository> = {},
): NoteSnapshotRepository {
  return {
    findContentByReference: notImpl,
    upsert: notImpl,
    findIdByReference: notImpl,
    deleteByReference: notImpl,
    ...overrides,
  };
}
