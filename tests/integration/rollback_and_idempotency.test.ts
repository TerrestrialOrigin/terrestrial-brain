import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import {
  callTool,
  callToolRaw,
  restUrl,
  serviceHeaders,
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
  uniqueName,
  uniqueToken,
} from "../helpers/mcp-client.ts";
import { SupabaseAiOutputRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-ai-output-repository.ts";
import { SupabaseTaskRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-task-repository.ts";
import { SupabasePersonRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-person-repository.ts";
import { SupabaseThoughtRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-thought-repository.ts";

// Step 15 (bug/RollbackAndIdempotency) — REPO-5 + TOOL-3.
//
// These are integration tests: they instantiate the REAL repository classes
// against the REAL local Supabase stack (no mocks on the code path under test,
// per the mock-boundary rule). Each idempotency test performs the mutation
// twice and asserts the first call's timestamp survives the second — proving
// the claim-style filter, not just that the query compiles.

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const aiOutputRepository = new SupabaseAiOutputRepository(supabase);
const taskRepository = new SupabaseTaskRepository(supabase);
const personRepository = new SupabasePersonRepository(supabase);
const thoughtRepository = new SupabaseThoughtRepository(supabase);

async function readColumn(
  table: string,
  id: string,
  column: string,
): Promise<unknown> {
  const response = await fetch(
    restUrl(`${table}?id=eq.${id}&select=${column}`),
    { headers: serviceHeaders() },
  );
  const rows = await response.json() as Record<string, unknown>[];
  if (!rows[0]) throw new Error(`read ${table}.${column} failed: no row`);
  return rows[0][column];
}

// ─── REPO-5: ai_output pickup / rejection idempotency ────────────────────────

Deno.test("markPickedUp: a retried pickup does not re-stamp picked_up_at", async () => {
  const { data: created, error } = await aiOutputRepository.insert({
    title: uniqueName("Pickup Idempotency"),
    content: "# body",
    file_path: `test/pickup-${uniqueToken()}.md`,
  });
  assertEquals(error, null);
  assertExists(created);
  const id = created!.id;

  const first = await aiOutputRepository.markPickedUp([id]);
  assertEquals(first.error, null);
  const afterFirst = await readColumn("ai_output", id, "picked_up_at");
  assertExists(afterFirst, "first pickup should stamp picked_up_at");

  const second = await aiOutputRepository.markPickedUp([id]);
  assertEquals(second.error, null, "retried pickup still reports success");
  const afterSecond = await readColumn("ai_output", id, "picked_up_at");

  assertEquals(
    afterSecond,
    afterFirst,
    "picked_up_at must be unchanged by the retried pickup",
  );
});

Deno.test("reject: a retried rejection does not re-stamp rejected_at", async () => {
  const { data: created, error } = await aiOutputRepository.insert({
    title: uniqueName("Reject Idempotency"),
    content: "# body",
    file_path: `test/reject-${uniqueToken()}.md`,
  });
  assertEquals(error, null);
  assertExists(created);
  const id = created!.id;

  const first = await aiOutputRepository.reject([id]);
  assertEquals(first.error, null);
  const afterFirst = await readColumn("ai_output", id, "rejected_at");
  assertExists(afterFirst, "first rejection should stamp rejected_at");

  const second = await aiOutputRepository.reject([id]);
  assertEquals(second.error, null, "retried rejection still reports success");
  const afterSecond = await readColumn("ai_output", id, "rejected_at");

  assertEquals(
    afterSecond,
    afterFirst,
    "rejected_at must be unchanged by the retried rejection",
  );
});

// ─── REPO-5: archive idempotency (task / person / thought) ───────────────────

Deno.test("task archive: re-archiving preserves the original archived_at", async () => {
  const { data: created, error } = await taskRepository.insert({
    content: uniqueName("Archive Idempotency Task"),
    status: "open",
  });
  assertEquals(error, null);
  assertExists(created);
  const id = created!.id;

  await taskRepository.archive(id);
  const afterFirst = await readColumn("tasks", id, "archived_at");
  assertExists(afterFirst, "first archive should stamp archived_at");

  await taskRepository.archive(id);
  const afterSecond = await readColumn("tasks", id, "archived_at");

  assertEquals(
    afterSecond,
    afterFirst,
    "archived_at must be unchanged by a re-archive",
  );
});

Deno.test("task archiveMany: already-archived tasks keep their archived_at", async () => {
  const { data: taskA } = await taskRepository.insert({
    content: uniqueName("ArchiveMany A"),
    status: "open",
  });
  const { data: taskB } = await taskRepository.insert({
    content: uniqueName("ArchiveMany B"),
    status: "open",
  });
  assertExists(taskA);
  assertExists(taskB);

  // Archive A first so it is already archived before the batch call.
  await taskRepository.archiveMany([taskA!.id]);
  const aArchivedAt = await readColumn("tasks", taskA!.id, "archived_at");
  assertExists(aArchivedAt);

  // Batch archive both — A is already archived, B is fresh.
  await taskRepository.archiveMany([taskA!.id, taskB!.id]);

  const aAfter = await readColumn("tasks", taskA!.id, "archived_at");
  const bAfter = await readColumn("tasks", taskB!.id, "archived_at");
  assertEquals(
    aAfter,
    aArchivedAt,
    "already-archived task's archived_at must not move",
  );
  assertExists(bAfter, "the fresh task should still be archived");
});

Deno.test("person archive: re-archiving preserves the original archived_at", async () => {
  const { data: created, error } = await personRepository.insert({
    name: uniqueName("Archive Idempotency Person"),
  });
  assertEquals(error, null);
  assertExists(created);
  const id = created!.id;

  await personRepository.archive(id);
  const afterFirst = await readColumn("people", id, "archived_at");
  assertExists(afterFirst, "first archive should stamp archived_at");

  await personRepository.archive(id);
  const afterSecond = await readColumn("people", id, "archived_at");

  assertEquals(
    afterSecond,
    afterFirst,
    "archived_at must be unchanged by a re-archive",
  );
});

Deno.test("thought archive: re-archiving preserves the original archived_at", async () => {
  const content = uniqueName("Archive Idempotency Thought");
  const { data: inserted, error: insertError } = await supabase
    .from("thoughts")
    .insert({ content })
    .select("id")
    .single();
  assertEquals(insertError, null);
  const id = inserted!.id as string;

  await thoughtRepository.archive(id);
  const afterFirst = await readColumn("thoughts", id, "archived_at");
  assertExists(afterFirst, "first archive should stamp archived_at");

  await thoughtRepository.archive(id);
  const afterSecond = await readColumn("thoughts", id, "archived_at");

  assertEquals(
    afterSecond,
    afterFirst,
    "archived_at must be unchanged by a re-archive",
  );
});

// ─── TOOL-3: create_tasks_with_output retry idempotency ──────────────────────

Deno.test("create_tasks_with_output: a retry with the same file_path does not double-insert", async () => {
  const filePath = `projects/RetryTest/tasks-${uniqueToken()}.md`;

  const first = await callTool("create_tasks_with_output", {
    title: uniqueName("Retry Tasks"),
    file_path: filePath,
    tasks: [{ content: uniqueName("retry task one") }],
  });
  assertEquals(first.includes("task(s)"), true, "first call should succeed");

  const { count: countAfterFirst } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("reference_id", filePath);
  assertEquals(countAfterFirst, 1, "first call inserts exactly one task");

  // Retry the same call (simulating an at-least-once client re-issue).
  const second = await callToolRaw("create_tasks_with_output", {
    title: uniqueName("Retry Tasks"),
    file_path: filePath,
    tasks: [{ content: uniqueName("retry task one") }],
  });
  assertEquals(
    second.isError,
    true,
    "retry with an existing file_path must be refused",
  );
  assertEquals(
    second.text.toLowerCase().includes("already exist"),
    true,
    "the refusal should say tasks for this file_path already exist",
  );

  const { count: countAfterSecond } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("reference_id", filePath);
  assertEquals(
    countAfterSecond,
    1,
    "the retry must not create a second set of task rows",
  );
});
