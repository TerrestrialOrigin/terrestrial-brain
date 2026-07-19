import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { handleUpdateThought } from "../../supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts";
import { SupabaseThoughtRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-thought-repository.ts";
import { FakeAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";
import { fakeThoughtRepository } from "./fakes/repository-fakes.ts";
import type { ThoughtRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/thought-repository.ts";

// Step 17 (update-thought-concurrency, TOOL-6): update_thought's
// read-modify-write must carry an optimistic-concurrency guard so an
// interleaved edit is rejected with a retryable error instead of silently
// losing the first writer's fields. Fakes sit only on the repository seam.

const READ_UPDATED_AT = "2026-07-19T10:00:00.123456+00:00";

interface RecordedUpdate {
  id: string;
  payload: Record<string, unknown>;
  options?: { expectedUpdatedAt?: string };
}

function fakeRepoForHandler(
  updateResult: { id: string } | null,
): { repo: ThoughtRepository; updates: RecordedUpdate[] } {
  const updates: RecordedUpdate[] = [];
  const forUpdateRow = {
    id: "thought-1",
    content: "existing content",
    reliability: "reliable",
    author: "author-one",
    metadata: {},
    updated_at: READ_UPDATED_AT,
  };
  const repo: ThoughtRepository = fakeThoughtRepository({
    findForUpdate: () => Promise.resolve({ data: forUpdateRow, error: null }),
    update: (
      id: string,
      payload: Record<string, unknown>,
      options?: { expectedUpdatedAt?: string },
    ) => {
      updates.push({ id, payload, options });
      return Promise.resolve({ data: updateResult, error: null });
    },
  });
  return { repo, updates };
}

function resultText(
  result: { content: { type: "text"; text: string }[]; isError?: boolean },
): string {
  return result.content.map((part) => part.text).join("\n");
}

Deno.test("handleUpdateThought: passes the read updated_at as the concurrency guard", async () => {
  const { repo, updates } = fakeRepoForHandler({ id: "thought-1" });

  await handleUpdateThought(new FakeAiProvider(), repo, {
    id: "thought-1",
    author: "author-two",
  });

  assertEquals(updates.length, 1);
  assertEquals(
    updates[0]?.options?.expectedUpdatedAt,
    READ_UPDATED_AT,
    "the handler must pass the updated_at it read as the guard",
  );
});

Deno.test("handleUpdateThought: a stale snapshot (no row matched) returns the concurrent-edit error", async () => {
  const { repo } = fakeRepoForHandler(null);

  const result = await handleUpdateThought(new FakeAiProvider(), repo, {
    id: "thought-1",
    author: "author-two",
  });

  const text = resultText(result);
  assertStringIncludes(text, "Concurrent edit");
  assertStringIncludes(
    text,
    "Re-read",
    "the error must tell the caller how to recover",
  );
  assertEquals(result.isError, true);
  assert(
    !text.includes("Thought updated"),
    `a clobbered write must not report success, got: ${text}`,
  );
});

Deno.test("handleUpdateThought: a fresh snapshot updates normally", async () => {
  const { repo } = fakeRepoForHandler({ id: "thought-1" });

  const result = await handleUpdateThought(new FakeAiProvider(), repo, {
    id: "thought-1",
    author: "author-two",
  });

  assertStringIncludes(resultText(result), "Thought updated: author");
  assert(result.isError !== true);
});

Deno.test("SupabaseThoughtRepository.update: guard adds the updated_at filter and selects the match", async () => {
  const { client, recorded } = makeFakeClient({ data: [{ id: "thought-1" }] });
  const repo = new SupabaseThoughtRepository(client);

  const { data, error } = await repo.update(
    "thought-1",
    { author: "author-two" },
    { expectedUpdatedAt: READ_UPDATED_AT },
  );

  assertEquals(error, null);
  assertEquals(data, { id: "thought-1" });
  const hasFilter = (column: string, value: unknown) =>
    recorded.filters.some((filter) =>
      filter.method === "eq" && filter.column === column &&
      filter.value === value
    );
  assertEquals(hasFilter("id", "thought-1"), true);
  assertEquals(
    hasFilter("updated_at", READ_UPDATED_AT),
    true,
    "the guard must become an updated_at filter on the update",
  );
  assertEquals(recorded.columns, "id");
});

Deno.test("SupabaseThoughtRepository.update: without the guard, filters on id only", async () => {
  const { client, recorded } = makeFakeClient({ data: [{ id: "thought-1" }] });
  const repo = new SupabaseThoughtRepository(client);

  const { error } = await repo.update("thought-1", { author: "author-two" });

  assertEquals(error, null);
  assertEquals(
    recorded.filters.some((filter) => filter.column === "updated_at"),
    false,
    "no guard → no updated_at filter (prior behavior preserved)",
  );
});

Deno.test("SupabaseThoughtRepository.update: zero rows matched yields data null", async () => {
  const { client } = makeFakeClient({ data: [] });
  const repo = new SupabaseThoughtRepository(client);

  const { data, error } = await repo.update(
    "thought-1",
    { author: "author-two" },
    { expectedUpdatedAt: READ_UPDATED_AT },
  );

  assertEquals(error, null);
  assertEquals(data, null);
});
