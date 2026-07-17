import { assertEquals } from "@std/assert";
import { resolveDedup } from "../../supabase/functions/terrestrial-brain-mcp/helpers.ts";
import type { ThoughtRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/thought-repository.ts";
import type { RepoError } from "../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

// CORE-2: resolveDedup must NOT read a failed lookup as "no duplicate". A failed
// content-hash or embedding query is a degraded outcome, not a clean miss — the
// caller needs to know the gate could not run rather than silently admit dupes.

const notImpl = () => Promise.reject(new Error("not implemented"));

function fakeThoughtRepository(
  overrides: Partial<ThoughtRepository>,
): ThoughtRepository {
  return {
    matchByEmbedding: notImpl,
    list: notImpl,
    stats: notImpl,
    findById: notImpl,
    findForUpdate: notImpl,
    findActiveById: notImpl,
    findByReference: notImpl,
    insert: notImpl,
    update: notImpl,
    archive: notImpl,
    archiveByDocumentReference: notImpl,
    incrementUsefulness: notImpl,
    incrementUsefulnessWeighted: notImpl,
    deleteByNoteSnapshot: notImpl,
    findByContentHash: notImpl,
    findStale: notImpl,
    findArchivalCandidates: notImpl,
    setSupersededBy: notImpl,
    touchRetrieved: notImpl,
    ...overrides,
  };
}

const DB_ERROR: RepoError = { message: "connection reset" };

Deno.test("resolveDedup: a failed content-hash lookup degrades (does not read as 'no duplicate')", async () => {
  const repo = fakeThoughtRepository({
    findByContentHash: () => Promise.resolve({ data: null, error: DB_ERROR }),
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await resolveDedup(repo, "hash-abc", [0.1, 0.2]);
    assertEquals(result.duplicateOf, null);
    assertEquals(result.degraded, true);
  } finally {
    console.error = originalError;
  }
});

Deno.test("resolveDedup: a failed embedding match degrades", async () => {
  const repo = fakeThoughtRepository({
    findByContentHash: () => Promise.resolve({ data: [], error: null }),
    matchByEmbedding: () => Promise.resolve({ data: null, error: DB_ERROR }),
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await resolveDedup(repo, "hash-abc", [0.1, 0.2]);
    assertEquals(result.duplicateOf, null);
    assertEquals(result.degraded, true);
  } finally {
    console.error = originalError;
  }
});

Deno.test("resolveDedup: a clean miss is not degraded", async () => {
  const repo = fakeThoughtRepository({
    findByContentHash: () => Promise.resolve({ data: [], error: null }),
    matchByEmbedding: () => Promise.resolve({ data: [], error: null }),
  });
  const result = await resolveDedup(repo, "hash-abc", [0.1, 0.2]);
  assertEquals(result, { duplicateOf: null, degraded: false });
});

Deno.test("resolveDedup: an exact content-hash hit reports the duplicate, not degraded", async () => {
  const repo = fakeThoughtRepository({
    findByContentHash: () =>
      Promise.resolve({ data: [{ id: "dup-1" }], error: null }),
  });
  const result = await resolveDedup(repo, "hash-abc", [0.1, 0.2]);
  assertEquals(result, { duplicateOf: "dup-1", degraded: false });
});
