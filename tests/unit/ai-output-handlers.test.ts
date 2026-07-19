import { assertEquals } from "@std/assert";
import {
  handleGetPendingAIOutput,
  handleMarkAIOutputPickedUp,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts";
import type {
  AiOutputRepository,
  PendingAiOutputRow,
} from "../../supabase/functions/terrestrial-brain-mcp/repositories/ai-output-repository.ts";
import type { RepoResult } from "../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

// Handler-level unit tests (fix-plan Step 17, GATE 2b): the rewired AI-output
// HTTP handlers run against a hand-written fake repository with NO database.

function fakeRepo(
  overrides: Partial<AiOutputRepository>,
): AiOutputRepository {
  const base: AiOutputRepository = {
    insert: () =>
      Promise.resolve({ data: { id: "o1" }, error: null } as RepoResult<
        { id: string }
      >),
    listPending: () =>
      Promise.resolve({ data: [], error: null } as RepoResult<
        PendingAiOutputRow[]
      >),
    listPendingMetadata: () =>
      Promise.resolve({ data: [], error: null } as RepoResult<unknown[]>),
    findContentByIds: () =>
      Promise.resolve({ data: [], error: null } as RepoResult<
        { id: string; content: string }[]
      >),
    markPickedUp: () => Promise.resolve({ data: null, error: null }),
    reject: () => Promise.resolve({ data: null, error: null }),
  };
  return { ...base, ...overrides };
}

Deno.test("handleGetPendingAIOutput: returns the repository rows", async () => {
  const rows: PendingAiOutputRow[] = [{
    id: "o1",
    title: "Plan",
    content: "# Plan",
    file_path: "plan.md",
    created_at: "2026-01-01T00:00:00Z",
  }];
  const repo = fakeRepo({
    listPending: () => Promise.resolve({ data: rows, error: null }),
  });

  const result = await handleGetPendingAIOutput(repo);

  assertEquals("data" in result, true);
  if ("data" in result) assertEquals(result.data, rows);
});

Deno.test("handleGetPendingAIOutput: surfaces a repository error", async () => {
  const repo = fakeRepo({
    listPending: () =>
      Promise.resolve({ data: null, error: { message: "db down" } }),
  });

  const result = await handleGetPendingAIOutput(repo);

  assertEquals("error" in result, true);
  if ("error" in result) assertEquals(result.error, "db down");
});

Deno.test("handleMarkAIOutputPickedUp: pluralized success message", async () => {
  const marked: string[] = [];
  const repo = fakeRepo({
    markPickedUp: (ids: string[]) => {
      marked.push(...ids);
      return Promise.resolve({ data: ids.length, error: null });
    },
  });

  const result = await handleMarkAIOutputPickedUp(repo, ["a", "b"]);

  assertEquals(marked, ["a", "b"]);
  assertEquals("message" in result, true);
  if ("message" in result) {
    assertEquals(result.message, "Marked 2 outputs as picked up.");
    assertEquals(result.updatedCount, 2);
  }
});

Deno.test("handleMarkAIOutputPickedUp: message counts rows actually updated, not the request", async () => {
  // Claim-style retry: repository reports 0 rows updated for a 2-id request.
  const repo = fakeRepo({
    markPickedUp: () => Promise.resolve({ data: 0, error: null }),
  });

  const result = await handleMarkAIOutputPickedUp(repo, ["a", "b"]);

  assertEquals("message" in result, true);
  if ("message" in result) {
    assertEquals(result.message, "Marked 0 outputs as picked up.");
    assertEquals(result.updatedCount, 0);
  }
});

Deno.test("handleMarkAIOutputPickedUp: surfaces a repository error", async () => {
  const repo = fakeRepo({
    markPickedUp: () =>
      Promise.resolve({ data: null, error: { message: "nope" } }),
  });

  const result = await handleMarkAIOutputPickedUp(repo, ["a"]);

  assertEquals("error" in result, true);
  if ("error" in result) assertEquals(result.error, "nope");
});
