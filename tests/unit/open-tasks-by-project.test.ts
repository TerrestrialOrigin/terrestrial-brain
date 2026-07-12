import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildOpenTasksByProjectText,
  handleOpenTasksByProject,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/tasks.ts";
import type {
  IncompleteTasksFilters,
  TaskListRow,
  TaskRepository,
} from "../../supabase/functions/terrestrial-brain-mcp/repositories/task-repository.ts";
import type { RepoResult } from "../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

// Unit tests for list_open_tasks_by_project. Pure grouping/formatting plus the
// handler run against a fake TaskRepository and fake name-resolvers — NO
// database, NO network. GATE 2b: deleting the grouping body, the truncation
// slice, or the returnedIds wiring reddens these.

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

function fakeRepo(
  listResult: RepoResult<TaskListRow[]>,
  capture?: (filters: IncompleteTasksFilters) => void,
): TaskRepository {
  return {
    list: () => Promise.resolve({ data: [], error: null }),
    listIncompleteUnarchived: (filters) => {
      capture?.(filters);
      return Promise.resolve(listResult);
    },
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

const NO_RESOLVE = () => Promise.resolve(new Map<string, string>());

// ─── Pure grouping / formatting ──────────────────────────────────────────────

Deno.test("buildOpenTasksByProjectText: groups by project, alphabetical, no-project last", () => {
  const text = buildOpenTasksByProjectText(
    [
      row({ id: "z1", content: "Zephyr task", project_id: "pz" }),
      row({ id: "a1", content: "Apollo task", project_id: "pa" }),
      row({ id: "n1", content: "Orphan task", project_id: null }),
    ],
    new Map([["pz", "Zephyr"], ["pa", "Apollo"]]),
    new Map(),
    { truncated: false, limit: 500 },
  );

  assertStringIncludes(text, "3 open task(s) across 3 group(s):");
  // Apollo group renders before Zephyr; (No project) is last.
  const apolloAt = text.indexOf("## Apollo");
  const zephyrAt = text.indexOf("## Zephyr");
  const noProjectAt = text.indexOf("## (No project)");
  assertEquals(apolloAt < zephyrAt, true, "Apollo before Zephyr");
  assertEquals(zephyrAt < noProjectAt, true, "(No project) last");
  assertStringIncludes(text, "## Apollo (1)");
  assertStringIncludes(text, "## (No project) (1)");
});

Deno.test("buildOpenTasksByProjectText: unresolved project id becomes an Unknown group, task not dropped", () => {
  const text = buildOpenTasksByProjectText(
    [row({ id: "t9", content: "Ghost task", project_id: "deleted-id" })],
    new Map(), // resolver found no name for the deleted project
    new Map(),
    { truncated: false, limit: 500 },
  );

  assertStringIncludes(text, "## (Unknown project deleted-id) (1)");
  assertStringIncludes(text, "Ghost task");
});

Deno.test("buildOpenTasksByProjectText: within-group order preserved and numbering restarts per group", () => {
  const text = buildOpenTasksByProjectText(
    [
      row({ id: "a1", content: "Alpha first", project_id: "pa" }),
      row({ id: "a2", content: "Alpha second", project_id: "pa" }),
      row({ id: "b1", content: "Beta only", project_id: "pb" }),
    ],
    new Map([["pa", "Alpha"], ["pb", "Beta"]]),
    new Map(),
    { truncated: false, limit: 500 },
  );

  assertStringIncludes(text, "1. [ ] Alpha first");
  assertStringIncludes(text, "2. [ ] Alpha second");
  // Beta group numbering restarts at 1.
  assertStringIncludes(text, "1. [ ] Beta only");
  // Group heading suppresses the redundant per-task "Project:" line.
  assertEquals(text.includes("Project: Alpha"), false);
});

Deno.test("buildOpenTasksByProjectText: truncation notice appended only when truncated", () => {
  const notTruncated = buildOpenTasksByProjectText(
    [row({ project_id: "pa" })],
    new Map([["pa", "Alpha"]]),
    new Map(),
    { truncated: false, limit: 2 },
  );
  assertEquals(notTruncated.includes("more exist"), false);

  const truncated = buildOpenTasksByProjectText(
    [row({ project_id: "pa" })],
    new Map([["pa", "Alpha"]]),
    new Map(),
    { truncated: true, limit: 2 },
  );
  assertStringIncludes(truncated, "Showing the first 2 tasks; more exist");
});

// ─── Handler behavior ────────────────────────────────────────────────────────

Deno.test("handleOpenTasksByProject: empty result is a success empty-state, not an error", async () => {
  const result = await handleOpenTasksByProject(
    fakeRepo({ data: [], error: null }),
    NO_RESOLVE,
    NO_RESOLVE,
    { limit: 500, include_deferred: true },
  );

  assertEquals(result.isError, undefined);
  assertEquals(result.content[0].text, "No open tasks.");
  assertEquals(result.meta?.recordsReturned, 0);
});

Deno.test("handleOpenTasksByProject: DB error surfaces as an error result", async () => {
  const result = await handleOpenTasksByProject(
    fakeRepo({ data: null, error: { message: "db down" } }),
    NO_RESOLVE,
    NO_RESOLVE,
    { limit: 500, include_deferred: true },
  );

  assertEquals(result.isError, true);
  assertStringIncludes(result.content[0].text, "db down");
});

Deno.test("handleOpenTasksByProject: reports real recordsReturned and returnedIds", async () => {
  const rows = [
    row({ id: "t1", project_id: "pa" }),
    row({ id: "t2", project_id: "pa" }),
  ];
  const result = await handleOpenTasksByProject(
    fakeRepo({ data: rows, error: null }),
    () => Promise.resolve(new Map([["pa", "Alpha"]])),
    NO_RESOLVE,
    { limit: 500, include_deferred: true },
  );

  assertEquals(result.meta?.recordsReturned, 2);
  assertEquals(result.meta?.returnedIds, ["t1", "t2"]);
});

Deno.test("handleOpenTasksByProject: limit+1 rows → slices to limit and reports truncation", async () => {
  // Repo fetches limit+1 (3) when limit is 2; handler must emit only 2 and flag truncation.
  const rows = [
    row({ id: "t1", project_id: "pa" }),
    row({ id: "t2", project_id: "pa" }),
    row({ id: "t3", project_id: "pa" }),
  ];
  const result = await handleOpenTasksByProject(
    fakeRepo({ data: rows, error: null }),
    () => Promise.resolve(new Map([["pa", "Alpha"]])),
    NO_RESOLVE,
    { limit: 2, include_deferred: true },
  );

  assertEquals(result.meta?.recordsReturned, 2);
  assertEquals(result.meta?.returnedIds, ["t1", "t2"]);
  assertStringIncludes(result.content[0].text, "Showing the first 2 tasks");
});

Deno.test("handleOpenTasksByProject: forwards include_deferred to the repository", async () => {
  const seen: IncompleteTasksFilters[] = [];
  await handleOpenTasksByProject(
    fakeRepo({ data: [], error: null }, (filters) => seen.push(filters)),
    NO_RESOLVE,
    NO_RESOLVE,
    { limit: 123, include_deferred: false },
  );

  assertEquals(seen, [{ limit: 123, includeDeferred: false }]);
});
