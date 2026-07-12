import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildTaskListText,
  handleListTasks,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/tasks.ts";
import type {
  TaskListRow,
  TaskRepository,
} from "../../supabase/functions/terrestrial-brain-mcp/repositories/task-repository.ts";
import type { RepoResult } from "../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

// Proves the Step 16 seam: the list_tasks handler now runs against a fake
// TaskRepository and fake name-resolvers — NO database, NO network. GATE 2b:
// deleting buildTaskListText's body (or the repo call) reddens these.

function fakeRepo(listResult: RepoResult<TaskListRow[]>): TaskRepository {
  return {
    list: () => Promise.resolve(listResult),
    listIncompleteUnarchived: () => Promise.resolve(listResult),
    insert: () => Promise.resolve({ data: null, error: null }),
    findByIds: () => Promise.resolve({ data: [], error: null }),
    update: () => Promise.resolve({ data: null, error: null }),
    archive: () => Promise.resolve({ data: null, error: null }),
    archiveIfActive: () => Promise.resolve({ data: null, error: null }),
    countOpenByProject: () => Promise.resolve({ data: 0, error: null }),
    countOpenByAssignee: () => Promise.resolve({ data: 0, error: null }),
    findOpenIdsByProjects: () => Promise.resolve({ data: [], error: null }),
    archiveMany: () => Promise.resolve({ data: null, error: null }),
    deleteByIds: () => Promise.resolve({ data: null, error: null }),
    findByReference: () => Promise.resolve({ data: [], error: null }),
  };
}

function row(overrides: Partial<TaskListRow> = {}): TaskListRow {
  return {
    id: "t1",
    content: "Do the thing",
    status: "open",
    due_by: null,
    project_id: null,
    assigned_to: null,
    archived_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

const NO_ARGS = { overdue_only: false, include_archived: false, limit: 20 };

Deno.test("handleListTasks: formats tasks with resolved project + person names", async () => {
  const repo = fakeRepo({
    data: [row({ project_id: "p1", assigned_to: "person1" })],
    error: null,
  });
  const projectIdsSeen: string[][] = [];
  const personIdsSeen: string[][] = [];

  const result = await handleListTasks(
    repo,
    (ids) => {
      projectIdsSeen.push(ids);
      return Promise.resolve(new Map([["p1", "Alpha"]]));
    },
    (ids) => {
      personIdsSeen.push(ids);
      return Promise.resolve(new Map([["person1", "Alice"]]));
    },
    NO_ARGS,
  );

  const text = result.content[0].text;
  assertStringIncludes(text, "Do the thing");
  assertStringIncludes(text, "ID: t1");
  assertStringIncludes(text, "Project: Alpha");
  assertStringIncludes(text, "Assigned to: Alice");
  assertEquals(result.isError, undefined);
  assertEquals(projectIdsSeen, [["p1"]]);
  assertEquals(personIdsSeen, [["person1"]]);
});

Deno.test("handleListTasks: empty result renders the no-tasks message", async () => {
  const repo = fakeRepo({ data: [], error: null });

  const result = await handleListTasks(
    repo,
    () => Promise.resolve(new Map()),
    () => Promise.resolve(new Map()),
    NO_ARGS,
  );

  assertEquals(result.content[0].text, "No tasks found.");
});

Deno.test("handleListTasks: DB error surfaces as an error result", async () => {
  const repo = fakeRepo({ data: null, error: { message: "db down" } });

  const result = await handleListTasks(
    repo,
    () => Promise.resolve(new Map()),
    () => Promise.resolve(new Map()),
    NO_ARGS,
  );

  assertEquals(result.isError, true);
  assertStringIncludes(result.content[0].text, "db down");
});

Deno.test("handleListTasks: no project/person ids → resolvers not called", async () => {
  const repo = fakeRepo({ data: [row()], error: null });
  let projectCalls = 0;
  let personCalls = 0;

  const result = await handleListTasks(
    repo,
    () => {
      projectCalls++;
      return Promise.resolve(new Map());
    },
    () => {
      personCalls++;
      return Promise.resolve(new Map());
    },
    NO_ARGS,
  );

  assertEquals(projectCalls, 0);
  assertEquals(personCalls, 0);
  const text = result.content[0].text;
  assertEquals(text.includes("Project:"), false);
  assertEquals(text.includes("Assigned to:"), false);
});

Deno.test("buildTaskListText: renders status icons and overdue markers", () => {
  const pastDue = "2000-01-01T00:00:00.000Z";
  const text = buildTaskListText(
    [
      row({ id: "a", content: "Done item", status: "done" }),
      row({ id: "b", content: "Late item", status: "open", due_by: pastDue }),
    ],
    new Map(),
    new Map(),
  );

  assertStringIncludes(text, "2 task(s):");
  assertStringIncludes(text, "[x] Done item");
  assertStringIncludes(text, "[ ] Late item");
  assertStringIncludes(text, "(OVERDUE)");
});
