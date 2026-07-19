import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  dispatchHttpRoute,
  HTTP_ROUTES,
  HttpRoute,
  HttpRouteDeps,
  matchHttpRoute,
  MAX_IDS_PER_REQUEST,
} from "../../supabase/functions/terrestrial-brain-mcp/http-routes.ts";
import { AiQuotaGate } from "../../supabase/functions/terrestrial-brain-mcp/ai-quota.ts";
import { FakeAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";
import {
  fakeAiOutputRepository,
  fakeNoteSnapshotRepository,
  fakePersonRepository,
  fakeProjectRepository,
  fakeTaskRepository,
  fakeThoughtRepository,
} from "./fakes/repository-fakes.ts";
import type { FunctionCallLogger } from "../../supabase/functions/terrestrial-brain-mcp/logger.ts";
import type { AiOutputRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/ai-output-repository.ts";
import type { AppSupabaseClient } from "../../supabase/functions/terrestrial-brain-mcp/supabase-client.ts";

// Step 18 (http-route-validation): the direct-HTTP route layer runs entirely
// against fakes here — schemas at the door (CORE-5), 400-vs-500 honesty +
// logged throws (CORE-6), one ids factory (CORE-14), base-anchored matching
// (CORE-17), and an injected quota gate (CORE-10). The dispatcher, matcher,
// and schemas under test are the real shipped code.

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

interface LoggedCall {
  kind: "call" | "result" | "error";
  detail: string;
}

function fakeLogger(log: LoggedCall[]): FunctionCallLogger {
  return {
    logCall: (name: string) => {
      log.push({ kind: "call", detail: name });
      return Promise.resolve("log-1");
    },
    logResult: (
      _logId: string,
      _records: number,
      _chars: number,
      errorDetails?: string | null,
    ) => {
      log.push({ kind: "result", detail: errorDetails ?? "" });
      return Promise.resolve();
    },
    logError: (_logId: string, errorDetails: string) => {
      log.push({ kind: "error", detail: errorDetails });
      return Promise.resolve();
    },
  };
}

function recordingAiOutputRepository(
  overrides: Partial<AiOutputRepository>,
  calls: string[],
): AiOutputRepository {
  const record = (name: string) => () => {
    calls.push(name);
    return Promise.reject(new Error(`${name} not implemented`));
  };
  return fakeAiOutputRepository({
    insert: record("insert"),
    listPending: record("listPending"),
    listPendingMetadata: record("listPendingMetadata"),
    findContentByIds: record("findContentByIds"),
    markPickedUp: record("markPickedUp"),
    reject: record("reject"),
    ...overrides,
  });
}

function makeDeps(options: {
  log: LoggedCall[];
  repositoryCalls: string[];
  quotaAllowed?: boolean;
  aiOutputOverrides?: Partial<AiOutputRepository>;
}): HttpRouteDeps {
  const { log, repositoryCalls, quotaAllowed = true } = options;
  // A real AiQuotaGate with a fake meter: unlimited when allowed, else a
  // limit of 1 with 99 metered calls already counted this month.
  const gate = new AiQuotaGate(quotaAllowed ? null : 1, {
    countMeteredCallsSince: () => Promise.resolve(quotaAllowed ? 0 : 99),
  });
  return {
    supabase: makeFakeClient({ data: null }).client as AppSupabaseClient,
    aiProvider: new FakeAiProvider(),
    thoughtRepository: fakeThoughtRepository(),
    taskRepository: fakeTaskRepository(),
    projectRepository: fakeProjectRepository(),
    personRepository: fakePersonRepository(),
    noteSnapshotRepository: fakeNoteSnapshotRepository(),
    aiOutputRepository: recordingAiOutputRepository(
      options.aiOutputOverrides ?? {},
      repositoryCalls,
    ),
    quotaGate: gate,
    logger: fakeLogger(log),
  };
}

function route(name: string): HttpRoute {
  const found = HTTP_ROUTES.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`route ${name} not found`);
  return found;
}

// ─── matchHttpRoute (CORE-17) ────────────────────────────────────────────────

Deno.test("matchHttpRoute: matches the exact function-base path", () => {
  const matched = matchHttpRoute(
    "/functions/v1/terrestrial-brain-mcp/ingest-note",
  );
  assertEquals(matched?.name, "ingest-note");
});

Deno.test("matchHttpRoute: a nested bogus path falls through to MCP", () => {
  assertEquals(
    matchHttpRoute(
      "/functions/v1/terrestrial-brain-mcp/anything/deeper/ingest-note",
    ),
    undefined,
  );
});

Deno.test("matchHttpRoute: the bare function path matches no route", () => {
  assertEquals(
    matchHttpRoute("/functions/v1/terrestrial-brain-mcp"),
    undefined,
  );
});

// ─── dispatcher envelope (CORE-5, CORE-6) ────────────────────────────────────

Deno.test("dispatch: malformed JSON returns 400, not 500, and logs no call", async () => {
  const log: LoggedCall[] = [];
  const outcome = await dispatchHttpRoute({
    route: route("ingest-note"),
    readBody: () => Promise.reject(new SyntaxError("Unexpected token")),
    deps: makeDeps({ log, repositoryCalls: [] }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 400);
  assertEquals(outcome.payload.error, "Invalid JSON body");
  assertEquals(log, []);
});

Deno.test("dispatch: missing content keeps the legacy message", async () => {
  const log: LoggedCall[] = [];
  const outcome = await dispatchHttpRoute({
    route: route("ingest-note"),
    readBody: () => Promise.resolve({}),
    deps: makeDeps({ log, repositoryCalls: [] }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 400);
  assertEquals(outcome.payload.error, "content is required");
});

Deno.test("dispatch: wrong-typed title is rejected with 400", async () => {
  const log: LoggedCall[] = [];
  const outcome = await dispatchHttpRoute({
    route: route("ingest-note"),
    readBody: () => Promise.resolve({ content: "note", title: 42 }),
    deps: makeDeps({ log, repositoryCalls: [] }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 400);
});

Deno.test("dispatch: missing ids keeps the legacy message and calls no repository", async () => {
  const log: LoggedCall[] = [];
  const repositoryCalls: string[] = [];
  const outcome = await dispatchHttpRoute({
    route: route("fetch-ai-output-content"),
    readBody: () => Promise.resolve({}),
    deps: makeDeps({ log, repositoryCalls }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 400);
  assertEquals(outcome.payload.error, "ids array is required");
  assertEquals(repositoryCalls, []);
});

Deno.test("dispatch: a non-UUID ids element is rejected before any repository call", async () => {
  const log: LoggedCall[] = [];
  const repositoryCalls: string[] = [];
  const outcome = await dispatchHttpRoute({
    route: route("mark-ai-output-picked-up"),
    readBody: () => Promise.resolve({ ids: ["not-a-uuid"] }),
    deps: makeDeps({ log, repositoryCalls }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 400);
  assertEquals(repositoryCalls, []);
});

Deno.test("dispatch: an oversized ids array is rejected with the cap in the message", async () => {
  const log: LoggedCall[] = [];
  const repositoryCalls: string[] = [];
  const tooMany = Array.from(
    { length: MAX_IDS_PER_REQUEST + 1 },
    () => VALID_UUID,
  );
  const outcome = await dispatchHttpRoute({
    route: route("reject-ai-output"),
    readBody: () => Promise.resolve({ ids: tooMany }),
    deps: makeDeps({ log, repositoryCalls }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 400);
  assertStringIncludes(String(outcome.payload.error), "100");
  assertEquals(repositoryCalls, []);
});

Deno.test("dispatch: a thrown handler returns 500 and records logError on the call's row", async () => {
  const log: LoggedCall[] = [];
  const throwingRoute: HttpRoute = {
    name: "explode",
    logName: "explode",
    handle: () => Promise.reject(new Error("handler exploded")),
  };
  const outcome = await dispatchHttpRoute({
    route: throwingRoute,
    readBody: () => Promise.resolve({}),
    deps: makeDeps({ log, repositoryCalls: [] }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 500);
  assertEquals(outcome.payload.error, "handler exploded");
  assert(
    log.some((entry) =>
      entry.kind === "error" && entry.detail.includes("handler exploded")
    ),
    `the throw must reach logError, got: ${JSON.stringify(log)}`,
  );
});

Deno.test("dispatch: a non-Error throw is stringified, never 'undefined'", async () => {
  const log: LoggedCall[] = [];
  const throwingRoute: HttpRoute = {
    name: "explode",
    logName: "explode",
    // deno-lint-ignore no-explicit-any
    handle: () => Promise.reject("string failure" as any),
  };
  const outcome = await dispatchHttpRoute({
    route: throwingRoute,
    readBody: () => Promise.resolve({}),
    deps: makeDeps({ log, repositoryCalls: [] }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 500);
  assertEquals(outcome.payload.error, "string failure");
});

// ─── quota gate through the seam (CORE-10) ───────────────────────────────────

Deno.test("dispatch: ingest-note over quota returns 429 via the injected gate", async () => {
  const log: LoggedCall[] = [];
  const outcome = await dispatchHttpRoute({
    route: route("ingest-note"),
    readBody: () => Promise.resolve({ content: "a note" }),
    deps: makeDeps({ log, repositoryCalls: [], quotaAllowed: false }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 429);
  assertStringIncludes(String(outcome.payload.error), "quota");
});

// ─── count honesty (CORE-5.3) ────────────────────────────────────────────────

Deno.test("dispatch: mark-ai-output-picked-up reports rows actually updated", async () => {
  const log: LoggedCall[] = [];
  const outcome = await dispatchHttpRoute({
    route: route("mark-ai-output-picked-up"),
    readBody: () => Promise.resolve({ ids: [VALID_UUID, VALID_UUID] }),
    deps: makeDeps({
      log,
      repositoryCalls: [],
      aiOutputOverrides: {
        // Claim-style retry: 0 rows actually updated for a 2-id request.
        markPickedUp: () => Promise.resolve({ data: 0, error: null }),
      },
    }),
    ipAddress: null,
  });

  assertEquals(outcome.status, 200);
  assertEquals(outcome.payload.message, "Marked 0 outputs as picked up.");
});
