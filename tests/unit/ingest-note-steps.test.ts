// Deterministic unit coverage for the reconciliation steps extracted from
// handleIngestNote (fix-plan Step 18). Uses a fake AiProvider and a fake
// ThoughtRepository — no live LLM, no DB. Pins the two behaviors that matter
// most: an unparseable plan degrades to null (fresh-ingest fallback) while a
// transport error propagates, and the delete list SOFT-ARCHIVES rather than
// hard-deletes (a hallucinated id must never destroy knowledge).

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  executeReconciliationPlan,
  formatIngestSummary,
  type ReconciliationPlan,
  requestReconciliationPlan,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts";
import {
  type AiJsonCompletionRequest,
  type AiProvider,
  AiProviderHttpError,
  AiProviderParseError,
} from "../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";
import type { ThoughtRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/thought-repository.ts";

// ─── fakes ───────────────────────────────────────────────────────────────────

function fakeAiProvider(
  completeJsonImpl?: <Parsed>(
    req: AiJsonCompletionRequest,
    parse: (raw: unknown) => Parsed,
  ) => Promise<Parsed>,
): AiProvider {
  return {
    getEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
    completeJson: <Parsed>(
      req: AiJsonCompletionRequest,
      parse: (raw: unknown) => Parsed,
    ): Promise<Parsed> =>
      completeJsonImpl
        ? completeJsonImpl(req, parse)
        : Promise.resolve(parse({})), // default: empty metadata
  };
}

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

// ─── requestReconciliationPlan ───────────────────────────────────────────────

Deno.test("requestReconciliationPlan: builds the prompt and returns the parsed plan", async () => {
  let captured: AiJsonCompletionRequest | null = null;
  // keep id must belong to this note (id-9) so the allowlist passes it through.
  const plan: ReconciliationPlan = {
    keep: ["id-9"],
    update: [],
    add: [],
    delete: [],
  };
  const provider = fakeAiProvider((req, parse) => {
    captured = req;
    return Promise.resolve(parse(plan));
  });

  const result = await requestReconciliationPlan(
    provider,
    [{
      id: "id-9",
      content: "old thought",
      created_at: "2026-01-01T00:00:00Z",
    }],
    "My Note",
    "new body",
  );

  assertEquals(result, plan);
  assertStringIncludes(captured!.systemPrompt, "You reconcile an updated note");
  assertStringIncludes(captured!.userContent, "[ID:id-9]");
  assertStringIncludes(captured!.userContent, "old thought");
  assertStringIncludes(captured!.userContent, "title: My Note");
  assertStringIncludes(captured!.userContent, "new body");
});

Deno.test("requestReconciliationPlan: unparseable plan degrades to null", async () => {
  const provider = fakeAiProvider(() =>
    Promise.reject(new AiProviderParseError("reconcile", "not json"))
  );
  const result = await requestReconciliationPlan(provider, [], "t", "c");
  assertEquals(result, null);
});

Deno.test("requestReconciliationPlan: transport error propagates (does NOT degrade)", async () => {
  const provider = fakeAiProvider(() =>
    Promise.reject(new AiProviderHttpError("reconcile", 502, "bad gateway"))
  );
  await assertRejects(
    () => requestReconciliationPlan(provider, [], "t", "c"),
    AiProviderHttpError,
  );
});

// ─── TOOL-1: reconciliation plan validation + id allowlist (failing-first) ───

const KNOWN_ID = "00000000-0000-0000-0000-0000000000aa";
const FOREIGN_ID = "11111111-1111-1111-1111-1111111111bb";

function existingThought(id: string) {
  return { id, content: "existing", created_at: "2026-01-01T00:00:00Z" };
}

Deno.test("requestReconciliationPlan: drops delete/update/keep ids not belonging to this note", async () => {
  const rawPlan = {
    keep: [KNOWN_ID, FOREIGN_ID],
    update: [
      { id: KNOWN_ID, content: "revised" },
      { id: FOREIGN_ID, content: "hallucinated overwrite" },
    ],
    add: [],
    delete: [KNOWN_ID, FOREIGN_ID],
  };
  const provider = fakeAiProvider((_req, parse) =>
    Promise.resolve(parse(rawPlan))
  );

  const result = await requestReconciliationPlan(
    provider,
    [existingThought(KNOWN_ID)],
    "t",
    "c",
  );

  assertExists(result);
  // The hallucinated foreign UUID must never reach update()/archive().
  assertEquals(result.keep, [KNOWN_ID]);
  assertEquals(result.delete, [KNOWN_ID]);
  assertEquals(result.update, [{ id: KNOWN_ID, content: "revised" }]);
});

Deno.test("requestReconciliationPlan: an update entry missing content degrades to null (fresh ingest)", async () => {
  const rawPlan = {
    keep: [],
    update: [{ id: KNOWN_ID }], // no content
    add: [],
    delete: [],
  };
  const provider = fakeAiProvider((_req, parse) =>
    Promise.resolve(parse(rawPlan))
  );
  const result = await requestReconciliationPlan(
    provider,
    [existingThought(KNOWN_ID)],
    "t",
    "c",
  );
  assertEquals(result, null);
});

Deno.test("requestReconciliationPlan: a non-array field degrades to null (fresh ingest)", async () => {
  const rawPlan = { keep: [], update: [], add: [], delete: "all" };
  const provider = fakeAiProvider((_req, parse) =>
    Promise.resolve(parse(rawPlan))
  );
  const result = await requestReconciliationPlan(
    provider,
    [existingThought(KNOWN_ID)],
    "t",
    "c",
  );
  assertEquals(result, null);
});

Deno.test("requestReconciliationPlan: an add entry that is an object (not a string) degrades to null", async () => {
  const rawPlan = {
    keep: [],
    update: [],
    add: [{ thought: "should have been a bare string" }],
    delete: [],
  };
  const provider = fakeAiProvider((_req, parse) =>
    Promise.resolve(parse(rawPlan))
  );
  const result = await requestReconciliationPlan(
    provider,
    [existingThought(KNOWN_ID)],
    "t",
    "c",
  );
  assertEquals(result, null);
});

// ─── executeReconciliationPlan ───────────────────────────────────────────────

Deno.test("executeReconciliationPlan: soft-archives deletes, counts each op", async () => {
  const archived: string[] = [];
  const inserted: unknown[] = [];
  const updated: string[] = [];
  const repo = fakeThoughtRepository({
    archive: (id) => {
      archived.push(id);
      return Promise.resolve({ data: undefined, error: null });
    },
    insert: (row) => {
      inserted.push(row);
      return Promise.resolve({ data: undefined, error: null });
    },
    update: (id) => {
      updated.push(id);
      return Promise.resolve({ data: { id }, error: null });
    },
  });

  const plan: ReconciliationPlan = {
    keep: ["kept"],
    update: [{ id: "u1", content: "revised" }],
    add: ["brand new thought"],
    delete: ["gone-1", "gone-2"],
  };

  const counts = await executeReconciliationPlan(repo, fakeAiProvider(), plan, {
    noteSnapshotId: "snap-1",
    noteId: "note-1",
    title: "T",
    references: {},
  });

  assertEquals(counts.updated, 1);
  assertEquals(counts.added, 1);
  assertEquals(counts.deleted, 2);
  assertEquals(counts.failures, 0);
  assertEquals(counts.opsLength, 4);
  // The delete list went through archive (soft), never a hard delete.
  assertEquals(archived.sort(), ["gone-1", "gone-2"]);
  assertEquals(updated, ["u1"]);
  assertEquals(inserted.length, 1);
});

Deno.test("executeReconciliationPlan: a failing archive is counted as a failure, not a delete", async () => {
  const repo = fakeThoughtRepository({
    archive: () =>
      Promise.resolve({ data: undefined, error: { message: "archive boom" } }),
  });
  const plan: ReconciliationPlan = {
    keep: [],
    update: [],
    add: [],
    delete: ["x1"],
  };
  const counts = await executeReconciliationPlan(repo, fakeAiProvider(), plan, {
    noteSnapshotId: null,
    noteId: "n",
    title: undefined,
    references: {},
  });
  assertEquals(counts.deleted, 0);
  assertEquals(counts.failures, 1);
  assertEquals(counts.opsLength, 1);
});

// ─── formatIngestSummary ─────────────────────────────────────────────────────

Deno.test("formatIngestSummary: composes counts + extraction suffix", () => {
  const { message, isError } = formatIngestSummary({
    keep: 2,
    counts: { updated: 1, added: 0, deleted: 1, failures: 0, opsLength: 2 },
    references: { tasks: ["a"], projects: [], people: ["p1", "p2"] },
    title: "My Note",
    noteId: "note-1",
  });
  assertEquals(
    message,
    'Synced "My Note": 2 unchanged, 1 updated, 1 removed | 1 task detected, 2 people referenced',
  );
  assertEquals(isError, false);
});

Deno.test("formatIngestSummary: all ops failed → isError true", () => {
  const { message, isError } = formatIngestSummary({
    keep: 0,
    counts: { updated: 0, added: 0, deleted: 0, failures: 2, opsLength: 2 },
    references: {},
    title: undefined,
    noteId: undefined,
  });
  assertStringIncludes(message, "2 failed");
  assertStringIncludes(message, 'Synced "note":');
  assertEquals(isError, true);
});

Deno.test("formatIngestSummary: no ops → 'no changes'", () => {
  const { message, isError } = formatIngestSummary({
    keep: 0,
    counts: { updated: 0, added: 0, deleted: 0, failures: 0, opsLength: 0 },
    references: {},
    title: undefined,
    noteId: "note-xyz",
  });
  assertEquals(message, 'Synced "note-xyz": no changes');
  assertEquals(isError, false);
});
