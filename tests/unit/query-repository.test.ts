import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SupabaseQueryRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-query-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";

// Unit tests for SupabaseQueryRepository (fix-plan Step 17). Each read method
// issues a single query, so the single-query fake covers them one at a time.

Deno.test("getProjectById: full row by id (single)", async () => {
  const { client, recorded } = makeFakeClient({ data: { id: "p1" } });
  const repo = new SupabaseQueryRepository(client);

  await repo.getProjectById("p1");

  assertEquals(recorded.table, "projects");
  assertEquals(recorded.columns, "*");
  assertEquals(recorded.single, true);
});

Deno.test("listOpenTasksForProject: open/in_progress, active, by project", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseQueryRepository(client);

  await repo.listOpenTasksForProject("p1");

  assertEquals(recorded.table, "tasks");
  assertEquals(
    recorded.filters.some((f) => f.column === "project_id" && f.value === "p1"),
    true,
  );
  assertEquals(
    recorded.filters.some((f) => f.method === "in" && f.column === "status"),
    true,
  );
  assertEquals(
    recorded.filters.some((f) => f.column === "archived_at"),
    true,
  );
});

Deno.test("listThoughtsForProjectNewFormat: contains projects-array metadata", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseQueryRepository(client);

  await repo.listThoughtsForProjectNewFormat("p1");

  assertEquals(recorded.table, "thoughts");
  assertEquals(recorded.limit, 25);
  const containsFilter = recorded.filters.find((f) => f.method === "contains");
  assertEquals(
    JSON.stringify(containsFilter?.value),
    JSON.stringify({ references: { projects: ["p1"] } }),
  );
});

Deno.test("listThoughtsForProjectOldFormat: contains project_id-string metadata", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseQueryRepository(client);

  await repo.listThoughtsForProjectOldFormat("p1");

  const containsFilter = recorded.filters.find((f) => f.method === "contains");
  assertEquals(
    JSON.stringify(containsFilter?.value),
    JSON.stringify({ references: { project_id: "p1" } }),
  );
});

Deno.test("listDeliveredAiOutputsSince: picked_up since date", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseQueryRepository(client);

  await repo.listDeliveredAiOutputsSince("2026-01-01T00:00:00Z");

  assertEquals(recorded.table, "ai_output");
  assertEquals(
    recorded.filters.some((f) => f.column === "picked_up" && f.value === true),
    true,
  );
  assertEquals(
    recorded.filters.some((f) =>
      f.method === "gte" && f.column === "picked_up_at"
    ),
    true,
  );
});

Deno.test("getNoteSnapshotByReference: by reference_id (single)", async () => {
  const { client, recorded } = makeFakeClient({ data: { id: "s1" } });
  const repo = new SupabaseQueryRepository(client);

  await repo.getNoteSnapshotByReference("notes/x.md");

  assertEquals(recorded.table, "note_snapshots");
  assertEquals(recorded.single, true);
  assertEquals(recorded.filters[0]?.column, "reference_id");
});

Deno.test("projectNamesByIds: delegates to resolveNames → id→name Map", async () => {
  const { client, recorded } = makeFakeClient({
    data: [{ id: "p1", name: "Apollo" }],
  });
  const repo = new SupabaseQueryRepository(client);

  const map = await repo.projectNamesByIds(["p1"]);

  assertEquals(recorded.table, "projects");
  assertEquals(map.get("p1"), "Apollo");
});

Deno.test("personNamesByIds: delegates to resolveNames on people", async () => {
  const { client, recorded } = makeFakeClient({
    data: [{ id: "person-1", name: "Ada" }],
  });
  const repo = new SupabaseQueryRepository(client);

  const map = await repo.personNamesByIds(["person-1"]);

  assertEquals(recorded.table, "people");
  assertEquals(map.get("person-1"), "Ada");
});

Deno.test("empty id list resolves without a query (resolveNames short-circuit)", async () => {
  const { client, recorded } = makeFakeClient({ data: [] });
  const repo = new SupabaseQueryRepository(client);

  const map = await repo.personNamesByIds([]);

  assertEquals(map.size, 0);
  assertEquals(recorded.table, undefined); // no query issued
});
