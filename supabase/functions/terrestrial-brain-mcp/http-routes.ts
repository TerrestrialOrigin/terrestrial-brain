// ─── Direct HTTP routes (non-MCP) ────────────────────────────────────────────
// The MCP transport handles most requests; a handful of plain-JSON POST routes
// (ingest-note, forget-note + the AI-output pull API) are served directly.
// Each route's body schema, success/error payload, status codes, and
// call/result logging live in one table + dispatcher (finding X1; Step 18).
// Every dependency — including the AI quota gate — is injected through
// `HttpRouteDeps`, so the whole table runs in unit tests with fakes (CORE-10).

import { z } from "zod";
import { uuidField } from "./zod-schemas.ts";
import { AiQuotaGate, quotaExceededMessage } from "./ai-quota.ts";
import { handleIngestNote } from "./tools/thoughts.ts";
import { forgetNote, formatForgetOutcome } from "./tools/forget_note.ts";
import {
  handleFetchAIOutputContent,
  handleGetPendingAIOutput,
  handleGetPendingAIOutputMetadata,
  handleMarkAIOutputPickedUp,
  handleRejectAIOutput,
} from "./tools/ai_output.ts";
import type { FunctionCallLogger } from "./logger.ts";
import type { AppSupabaseClient } from "./supabase-client.ts";
import type { AiProvider } from "./ai/ai-provider.ts";
import type { ThoughtRepository } from "./repositories/thought-repository.ts";
import type { TaskRepository } from "./repositories/task-repository.ts";
import type { ProjectRepository } from "./repositories/project-repository.ts";
import type { PersonRepository } from "./repositories/person-repository.ts";
import type { NoteSnapshotRepository } from "./repositories/note-snapshot-repository.ts";
import type { AiOutputRepository } from "./repositories/ai-output-repository.ts";

/** Every seam a direct HTTP route may use — injected, never module-scope. */
export interface HttpRouteDeps {
  supabase: AppSupabaseClient;
  aiProvider: AiProvider;
  thoughtRepository: ThoughtRepository;
  taskRepository: TaskRepository;
  projectRepository: ProjectRepository;
  personRepository: PersonRepository;
  noteSnapshotRepository: NoteSnapshotRepository;
  aiOutputRepository: AiOutputRepository;
  quotaGate: AiQuotaGate;
  logger: FunctionCallLogger;
  /** Injectable clock (CORE-13) — the composition root passes `Date.now`. */
  now: () => number;
}

export type HttpRouteResult =
  | { ok: true; data?: unknown; message?: string; recordCount: number }
  | { ok: false; error: string; status: 400 | 429 | 500 };

export interface HttpRoute {
  /** Final path segment (no slash) — matched exactly by `matchHttpRoute`. */
  name: string;
  logName: string;
  /** When present, the dispatcher parses + validates the JSON body with it. */
  bodySchema?: z.ZodType<unknown>;
  handle(deps: HttpRouteDeps, body: unknown): Promise<HttpRouteResult>;
}

/**
 * Typed route builder: the handler receives the schema's parsed output, so no
 * route ever casts raw request JSON (parse, don't cast — CORE-5). The single
 * widening to `HttpRoute` happens here, at one seam, after validation is wired.
 */
function defineRoute<Body>(route: {
  name: string;
  logName: string;
  bodySchema?: z.ZodType<Body>;
  handle: (deps: HttpRouteDeps, body: Body) => Promise<HttpRouteResult>;
}): HttpRoute {
  return route as HttpRoute;
}

/** Upper bound on ids per pull-API request (bounded queries, CORE-5). */
export const MAX_IDS_PER_REQUEST = 100;

// Legacy 400 messages are pinned so existing clients see identical envelopes.
const IDS_REQUIRED = "ids array is required";

const IngestNoteBody = z.object({
  content: z.string("content is required").refine(
    (value) => value.trim().length > 0,
    "content is required",
  ),
  title: z.string().optional(),
  note_id: z.string().optional(),
});

const ForgetNoteBody = z.object({
  note_id: z.string("note_id is required").refine(
    (value) => value.trim().length > 0,
    "note_id is required",
  ),
});

const IdsBody = z.object({
  ids: z.array(uuidField(), IDS_REQUIRED)
    .min(1, IDS_REQUIRED)
    .max(
      MAX_IDS_PER_REQUEST,
      `ids array is limited to ${MAX_IDS_PER_REQUEST} ids per request`,
    ),
});

// Narrow the AI-output handlers' `{ error } | { data }` union into a
// data HttpRouteResult; `"error" in result` is the discriminant.
function dataOutcome(
  result: { error: string } | { data: unknown },
): HttpRouteResult {
  if ("error" in result) return { ok: false, error: result.error, status: 500 };
  return {
    ok: true,
    data: result.data,
    recordCount: Array.isArray(result.data) ? result.data.length : 1,
  };
}

/**
 * The three pull-API ids routes share one schema + shape (Rule of Three,
 * CORE-14): validated UUID ids in, an AI-output handler outcome back.
 */
function idsRoute(
  name: string,
  run: (
    repository: AiOutputRepository,
    ids: string[],
  ) => Promise<HttpRouteResult>,
): HttpRoute {
  return defineRoute({
    name,
    logName: name,
    bodySchema: IdsBody,
    handle: (deps, body) => run(deps.aiOutputRepository, body.ids),
  });
}

export const HTTP_ROUTES: HttpRoute[] = [
  defineRoute({
    name: "ingest-note",
    logName: "ingest-note",
    bodySchema: IngestNoteBody,
    handle: async (deps, body) => {
      // Metered AI operation (Step 15): refused before any embedding/extraction
      // when over quota, with a distinct 429 (never a silent success/skip).
      const quota = await deps.quotaGate.check(deps.now());
      if (!quota.allowed) {
        return { ok: false, error: quotaExceededMessage(quota), status: 429 };
      }
      const result = await handleIngestNote(
        deps.supabase,
        deps.aiProvider,
        deps.thoughtRepository,
        deps.taskRepository,
        deps.projectRepository,
        deps.personRepository,
        deps.noteSnapshotRepository,
        {
          content: body.content,
          title: body.title,
          note_id: body.note_id,
        },
      );
      if (!result.success) {
        return {
          ok: false,
          error: result.error || "Unknown error",
          status: 500,
        };
      }
      return { ok: true, message: result.message, recordCount: 1 };
    },
  }),
  defineRoute({
    name: "forget-note",
    logName: "forget-note",
    bodySchema: ForgetNoteBody,
    handle: async (deps, body) => {
      const outcome = await forgetNote(
        deps.noteSnapshotRepository,
        deps.thoughtRepository,
        body.note_id,
      );
      if (!outcome.ok) {
        return { ok: false, error: outcome.error, status: 500 };
      }
      return {
        ok: true,
        message: formatForgetOutcome(body.note_id, outcome),
        recordCount: outcome.thoughtsDeleted +
          (outcome.snapshotExisted ? 1 : 0),
      };
    },
  }),
  defineRoute({
    name: "get-pending-ai-output",
    logName: "get-pending-ai-output",
    handle: async (deps) =>
      dataOutcome(await handleGetPendingAIOutput(deps.aiOutputRepository)),
  }),
  defineRoute({
    name: "get-pending-ai-output-metadata",
    logName: "get-pending-ai-output-metadata",
    handle: async (deps) =>
      dataOutcome(
        await handleGetPendingAIOutputMetadata(deps.aiOutputRepository),
      ),
  }),
  idsRoute(
    "fetch-ai-output-content",
    async (repository, ids) =>
      dataOutcome(await handleFetchAIOutputContent(repository, ids)),
  ),
  idsRoute("mark-ai-output-picked-up", async (repository, ids) => {
    const result = await handleMarkAIOutputPickedUp(repository, ids);
    if ("error" in result) {
      return { ok: false, error: result.error, status: 500 };
    }
    // Count what actually succeeded, never the request's array length (CORE-5).
    return {
      ok: true,
      message: result.message,
      recordCount: result.updatedCount,
    };
  }),
  idsRoute("reject-ai-output", async (repository, ids) => {
    const result = await handleRejectAIOutput(repository, ids);
    if ("error" in result) {
      return { ok: false, error: result.error, status: 500 };
    }
    return {
      ok: true,
      message: result.message,
      recordCount: result.updatedCount,
    };
  }),
];

/** The edge function's own base path segment routes are anchored under. */
const FUNCTION_BASE_SEGMENT = "terrestrial-brain-mcp";

/**
 * Matches a direct HTTP route only at exactly `<function-base>/<name>` —
 * the final segment must equal the route name AND the segment before it must
 * be the function's own base segment, so a nested bogus path can never
 * silently "work" (CORE-17). Everything else falls through to MCP.
 */
export function matchHttpRoute(
  pathname: string,
  routes: HttpRoute[] = HTTP_ROUTES,
): HttpRoute | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) return undefined;
  const routeName = segments[segments.length - 1];
  const parentSegment = segments[segments.length - 2];
  if (parentSegment !== FUNCTION_BASE_SEGMENT) return undefined;
  return routes.find((route) => route.name === routeName);
}

export interface HttpDispatchOutcome {
  payload: Record<string, unknown>;
  status: 200 | 400 | 429 | 500;
}

/**
 * Runs one matched route: parse (400 on malformed JSON) → logCall → validate
 * (400 with the schema's message) → handle (typed body) → logResult; a thrown
 * handler is normalized, recorded on the SAME log row via `logError` (no more
 * orphaned rows without error_details — CORE-6), and returned as a 500.
 */
export async function dispatchHttpRoute(options: {
  route: HttpRoute;
  readBody: () => Promise<unknown>;
  deps: HttpRouteDeps;
  ipAddress: string | null;
}): Promise<HttpDispatchOutcome> {
  const { route, readBody, deps, ipAddress } = options;
  const { logger } = options.deps;

  // Client-side failure (malformed JSON) is a 400, not a 500, and happens
  // before logCall — no log row exists yet, matching prior telemetry shape.
  let rawBody: unknown = {};
  if (route.bodySchema) {
    try {
      rawBody = await readBody();
    } catch {
      return {
        payload: { success: false, error: "Invalid JSON body" },
        status: 400,
      };
    }
  }

  const logId = await logger.logCall(
    route.logName,
    "http",
    rawBody as Record<string, unknown>,
    ipAddress,
  );

  let body: unknown = rawBody;
  if (route.bodySchema) {
    const parsed = route.bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ??
        "Invalid request body";
      if (logId) await logger.logResult(logId, 0, 0, message);
      return { payload: { success: false, error: message }, status: 400 };
    }
    body = parsed.data;
  }

  try {
    const result = await route.handle(deps, body);

    if (!result.ok) {
      if (logId) await logger.logResult(logId, 0, 0, result.error);
      return {
        payload: { success: false, error: result.error },
        status: result.status,
      };
    }

    if (result.data !== undefined) {
      const responseJson = JSON.stringify(result.data);
      if (logId) {
        await logger.logResult(logId, result.recordCount, responseJson.length);
      }
      return { payload: { success: true, data: result.data }, status: 200 };
    }

    const responseText = result.message ?? "";
    if (logId) {
      await logger.logResult(logId, result.recordCount, responseText.length);
    }
    return { payload: { success: true, message: result.message }, status: 200 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (logId) await logger.logError(logId, message);
    return { payload: { success: false, error: message }, status: 500 };
  }
}
