import { assertEquals } from "@std/assert";
import {
  archiveProjectCascade,
  wouldCreateProjectCycle,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/projects.ts";
import type { ProjectRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/project-repository.ts";
import type { TaskRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/task-repository.ts";
import type { RepoError } from "../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

// TOOL-2: archive_project must (1) surface traversal/lookup errors instead of
// rendering them as success, (2) archive tasks BEFORE projects so a crash leaves
// a recoverable (still-active) state, and (3) terminate on a parent cycle.

const notImpl = () => Promise.reject(new Error("not implemented"));
const DB_ERROR: RepoError = { message: "db unavailable" };

interface FakeConfig {
  childIdsByParent?: Record<string, string[]>;
  childIdsError?: RepoError;
  openTaskIds?: string[];
  openTasksError?: RepoError;
  archiveProjectsError?: RepoError;
  archiveTasksError?: RepoError;
  parents?: Record<string, string | null>;
  findByIdError?: RepoError;
}

function makeRepos(config: FakeConfig) {
  const calls: string[] = [];
  const project: ProjectRepository = {
    insert: notImpl,
    list: notImpl,
    findById: (id: string) => {
      calls.push(`findById:${id}`);
      if (config.findByIdError) {
        return Promise.resolve({ data: null, error: config.findByIdError });
      }
      const parent_id = config.parents?.[id] ?? null;
      // Only `parent_id` is read by wouldCreateProjectCycle.
      return Promise.resolve({
        data: { parent_id } as never,
        error: null,
      });
    },
    findName: notImpl,
    findByName: notImpl,
    listChildrenBasic: notImpl,
    listChildParentIds: notImpl,
    listActiveChildIds: (parentIds: string[]) => {
      calls.push(`listActiveChildIds:${parentIds.join(",")}`);
      if (config.childIdsError) {
        return Promise.resolve({ data: null, error: config.childIdsError });
      }
      const ids = parentIds.flatMap((parent) =>
        (config.childIdsByParent?.[parent] ?? []).map((id) => ({ id }))
      );
      return Promise.resolve({ data: ids, error: null });
    },
    update: notImpl,
    archiveManyActive: (ids: string[]) => {
      calls.push(`archiveManyActive:${ids.join(",")}`);
      return Promise.resolve({
        data: null,
        error: config.archiveProjectsError ?? null,
      });
    },
    listActive: notImpl,
  };
  const task: TaskRepository = {
    insert: notImpl,
    list: notImpl,
    listIncompleteUnarchived: notImpl,
    findByIds: notImpl,
    update: notImpl,
    archive: notImpl,
    archiveIfActive: notImpl,
    countOpenByProject: notImpl,
    countOpenByAssignee: notImpl,
    findOpenIdsByProjects: (projectIds: string[]) => {
      calls.push(`findOpenIdsByProjects:${projectIds.join(",")}`);
      if (config.openTasksError) {
        return Promise.resolve({ data: null, error: config.openTasksError });
      }
      return Promise.resolve({
        data: (config.openTaskIds ?? []).map((id) => ({ id })),
        error: null,
      });
    },
    archiveMany: (ids: string[]) => {
      calls.push(`archiveMany:${ids.join(",")}`);
      return Promise.resolve({
        data: null,
        error: config.archiveTasksError ?? null,
      });
    },
    deleteByIds: notImpl,
    findByReference: notImpl,
  };
  return { project, task, calls };
}

Deno.test("archiveProjectCascade: a failed child-project lookup aborts with no archive writes", async () => {
  const { project, task, calls } = makeRepos({ childIdsError: DB_ERROR });
  const outcome = await archiveProjectCascade(project, task, "root");
  assertEquals(outcome.ok, false);
  assertEquals(calls.some((c) => c.startsWith("archiveManyActive")), false);
  assertEquals(calls.some((c) => c.startsWith("archiveMany:")), false);
});

Deno.test("archiveProjectCascade: a failed open-tasks lookup aborts with no archive writes", async () => {
  const { project, task, calls } = makeRepos({ openTasksError: DB_ERROR });
  const outcome = await archiveProjectCascade(project, task, "root");
  assertEquals(outcome.ok, false);
  assertEquals(calls.some((c) => c.startsWith("archiveManyActive")), false);
  assertEquals(calls.some((c) => c.startsWith("archiveMany:")), false);
});

Deno.test("archiveProjectCascade: archives tasks BEFORE projects (recoverable order)", async () => {
  const { project, task, calls } = makeRepos({
    childIdsByParent: { root: ["child"] },
    openTaskIds: ["t1", "t2"],
  });
  const outcome = await archiveProjectCascade(project, task, "root");
  assertEquals(outcome.ok, true);
  const taskArchiveAt = calls.findIndex((c) => c.startsWith("archiveMany:"));
  const projectArchiveAt = calls.findIndex((c) =>
    c.startsWith("archiveManyActive")
  );
  assertEquals(
    taskArchiveAt >= 0 && taskArchiveAt < projectArchiveAt,
    true,
    `tasks must be archived before projects; calls=${JSON.stringify(calls)}`,
  );
});

Deno.test("archiveProjectCascade: a cyclic project graph terminates", async () => {
  // root -> a -> b -> a (cycle). Must not spin forever.
  const { project, task } = makeRepos({
    childIdsByParent: { root: ["a"], a: ["b"], b: ["a"] },
  });
  const outcome = await archiveProjectCascade(project, task, "root");
  assertEquals(outcome.ok, true);
});

Deno.test("wouldCreateProjectCycle: self-parent is a cycle", async () => {
  const { project } = makeRepos({});
  assertEquals(
    (await wouldCreateProjectCycle(project, "x", "x")).cycle,
    true,
  );
});

Deno.test("wouldCreateProjectCycle: making an ancestor's parent a descendant is a cycle", async () => {
  // Existing: b.parent = a, a.parent = null. Proposing a.parent = b closes a loop.
  const { project } = makeRepos({ parents: { b: "a", a: null } });
  assertEquals((await wouldCreateProjectCycle(project, "a", "b")).cycle, true);
});

Deno.test("wouldCreateProjectCycle: an unrelated parent is not a cycle", async () => {
  const { project } = makeRepos({ parents: { p: null } });
  assertEquals((await wouldCreateProjectCycle(project, "a", "p")).cycle, false);
});
