import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

import {
  handleIngestNote,
  register as registerThoughts,
} from "./tools/thoughts.ts";
import { register as registerProjects } from "./tools/projects.ts";
import { register as registerTasks } from "./tools/tasks.ts";
import {
  handleFetchAIOutputContent,
  handleGetPendingAIOutput,
  handleGetPendingAIOutputMetadata,
  handleMarkAIOutputPickedUp,
  handleRejectAIOutput,
  register as registerAIOutput,
} from "./tools/ai_output.ts";
import { register as registerQueries } from "./tools/queries.ts";
import { register as registerPeople } from "./tools/people.ts";
import { register as registerDocuments } from "./tools/documents.ts";
import {
  createFunctionCallLogger,
  extractIpAddress,
  FunctionCallLogger,
} from "./logger.ts";
import { runWithRequestContext } from "./requestContext.ts";
import { requireEnv } from "./env.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiProvider } from "./ai/ai-provider.ts";
import { createAiProvider } from "./ai/factory.ts";
import type { ThoughtRepository } from "./repositories/thought-repository.ts";
import type { TaskRepository } from "./repositories/task-repository.ts";
import { SupabaseThoughtRepository } from "./repositories/supabase-thought-repository.ts";
import { SupabaseTaskRepository } from "./repositories/supabase-task-repository.ts";

// Composition-root secrets: validated at cold start so a missing var fails the
// boot loudly (named in the error) rather than surfacing later as broken auth or
// a corrupt outbound request (finding X5).
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const MCP_ACCESS_KEY = requireEnv("MCP_ACCESS_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const logger = createFunctionCallLogger(supabase);
// Repository seams over the `thoughts` / `tasks` tables (fix-plan Step 16).
// Stateless wrappers over the shared client — constructed once and injected.
const thoughtRepository = new SupabaseThoughtRepository(supabase);
const taskRepository = new SupabaseTaskRepository(supabase);
// The single AiProvider seam over OpenRouter (fix-plan Step 15). Constructed once
// here and injected into consumers; the provider is stateless, so one instance is
// safe to share across requests. Step 22 will branch this factory on TB_AI_PROVIDER.
const aiProvider = createAiProvider();

// ─── MCP Server factory ─────────────────────────────────────────────────────
// A fresh server is built per request (see the MCP branch below), following the
// MCP SDK's stateless-transport guidance: one server + transport per request
// rather than a single shared instance connected on every call. Tool
// registration lives here so no request mutates state shared with a concurrent
// request. `supabase` and `logger` are stateless singletons, so per-request
// construction adds only in-memory wiring, not a DB reconnect.

function createMcpServer(
  supabaseClient: SupabaseClient,
  callLogger: FunctionCallLogger,
  provider: AiProvider,
  thoughtRepo: ThoughtRepository,
  taskRepo: TaskRepository,
): McpServer {
  const server = new McpServer({
    name: "open-brain",
    version: "1.0.0",
  });

  // Only thoughts + documents run the extraction pipeline / embeddings, so only
  // they receive the AiProvider; thoughts + tasks + documents receive the
  // repository seams (documents forwards taskRepo to the pipeline only).
  registerThoughts(
    server,
    supabaseClient,
    callLogger,
    provider,
    thoughtRepo,
    taskRepo,
  );
  registerProjects(server, supabaseClient, callLogger);
  registerTasks(server, supabaseClient, callLogger, taskRepo);
  registerAIOutput(server, supabaseClient, callLogger);
  registerQueries(server, supabaseClient, callLogger);
  registerPeople(server, supabaseClient, callLogger);
  registerDocuments(server, supabaseClient, callLogger, provider, taskRepo);

  return server;
}

// ─── Hono App with Auth Check ─────────────────────────────────────────────────

/**
 * Constant-time access-key comparison. Both values are hashed to fixed-length
 * SHA-256 digests first (removes the length side channel), then compared with
 * a branch-free XOR fold so the comparison never short-circuits.
 */
async function accessKeyMatches(
  providedKey: string,
  expectedKey: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(providedKey)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedKey)),
  ]);
  const providedBytes = new Uint8Array(providedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index++) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

// ─── Direct HTTP routes (non-MCP) ────────────────────────────────────────────
// The MCP transport handles most requests; a handful of plain-JSON POST routes
// (ingest-note + the AI-output pull API) are served directly. Each route's
// validation, success/error payload, status codes, and call/result logging live
// in one table + dispatcher instead of six near-identical hand-written blocks
// (finding X1). A route's `handle` returns a normalized result; the dispatcher
// below owns all the logging and JSON-envelope scaffolding.

interface HttpRouteContext {
  supabase: SupabaseClient;
  aiProvider: AiProvider;
  thoughtRepository: ThoughtRepository;
  taskRepository: TaskRepository;
  body: Record<string, unknown>;
}

type HttpRouteResult =
  | { ok: true; data?: unknown; message?: string; recordCount: number }
  | { ok: false; error: string; status: 400 | 500 };

interface HttpRoute {
  suffix: string;
  logName: string;
  parseBody: boolean;
  handle: (ctx: HttpRouteContext) => Promise<HttpRouteResult>;
}

const IDS_REQUIRED = "ids array is required";

// Narrow the AI-output handlers' `{ error } | { data | message }` union into a
// data/message HttpRouteResult; `"error" in result` is the discriminant.
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

const HTTP_ROUTES: HttpRoute[] = [
  {
    suffix: "/ingest-note",
    logName: "ingest-note",
    parseBody: true,
    handle: async (
      { supabase, aiProvider, thoughtRepository, taskRepository, body },
    ) => {
      const content = body.content;
      if (
        !content || typeof content !== "string" || content.trim().length === 0
      ) {
        return { ok: false, error: "content is required", status: 400 };
      }
      const result = await handleIngestNote(
        supabase,
        aiProvider,
        thoughtRepository,
        taskRepository,
        {
          content,
          title: body.title as string | undefined,
          note_id: body.note_id as string | undefined,
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
  },
  {
    suffix: "/get-pending-ai-output",
    logName: "get-pending-ai-output",
    parseBody: false,
    handle: async ({ supabase }) =>
      dataOutcome(await handleGetPendingAIOutput(supabase)),
  },
  {
    suffix: "/get-pending-ai-output-metadata",
    logName: "get-pending-ai-output-metadata",
    parseBody: false,
    handle: async ({ supabase }) =>
      dataOutcome(await handleGetPendingAIOutputMetadata(supabase)),
  },
  {
    suffix: "/fetch-ai-output-content",
    logName: "fetch-ai-output-content",
    parseBody: true,
    handle: async ({ supabase, body }) => {
      const ids = body.ids;
      if (!ids || !Array.isArray(ids)) {
        return { ok: false, error: IDS_REQUIRED, status: 400 };
      }
      return dataOutcome(
        await handleFetchAIOutputContent(supabase, ids as string[]),
      );
    },
  },
  {
    suffix: "/mark-ai-output-picked-up",
    logName: "mark-ai-output-picked-up",
    parseBody: true,
    handle: async ({ supabase, body }) => {
      const ids = body.ids;
      if (!ids || !Array.isArray(ids)) {
        return { ok: false, error: IDS_REQUIRED, status: 400 };
      }
      const result = await handleMarkAIOutputPickedUp(
        supabase,
        ids as string[],
      );
      if ("error" in result) {
        return { ok: false, error: result.error, status: 500 };
      }
      return { ok: true, message: result.message, recordCount: ids.length };
    },
  },
  {
    suffix: "/reject-ai-output",
    logName: "reject-ai-output",
    parseBody: true,
    handle: async ({ supabase, body }) => {
      const ids = body.ids;
      if (!ids || !Array.isArray(ids)) {
        return { ok: false, error: IDS_REQUIRED, status: 400 };
      }
      const result = await handleRejectAIOutput(supabase, ids as string[]);
      if ("error" in result) {
        return { ok: false, error: result.error, status: 500 };
      }
      return { ok: true, message: result.message, recordCount: ids.length };
    },
  },
];

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["POST", "GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-brain-key"],
  }),
);

// ─── Unified handler: route by URL path ──────────────────────────────────────
// Supabase Edge Functions may not pass subpaths to Hono's router, so we check
// the raw URL to distinguish /ingest-note from MCP requests.

app.all("*", async (c) => {
  const url = new URL(c.req.url);
  // x-brain-key header is the primary mechanism; ?key= is a deprecated
  // fallback kept for MCP clients that cannot set custom headers.
  const providedKey = c.req.header("x-brain-key") ||
    url.searchParams.get("key");
  if (!providedKey || !(await accessKeyMatches(providedKey, MCP_ACCESS_KEY))) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  const ipAddress = extractIpAddress(c.req.raw.headers);

  // Direct HTTP routes (table-driven; see HTTP_ROUTES above). Matched by path
  // suffix on POST; everything else falls through to the MCP transport below.
  if (c.req.method === "POST") {
    const route = HTTP_ROUTES.find((r) => url.pathname.endsWith(r.suffix));
    if (route) {
      try {
        // parseBody routes read JSON up front; malformed JSON throws here and is
        // caught below as a 500 (matching the previous per-block behavior), and
        // no call is logged — the parse fails before logCall, as before.
        const body: Record<string, unknown> = route.parseBody
          ? await c.req.json()
          : {};
        const logId = await logger.logCall(
          route.logName,
          "http",
          body,
          ipAddress,
        );

        const result = await route.handle({
          supabase,
          aiProvider,
          thoughtRepository,
          taskRepository,
          body,
        });

        if (!result.ok) {
          if (logId) await logger.logResult(logId, 0, 0, result.error);
          return c.json({ success: false, error: result.error }, result.status);
        }

        if (result.data !== undefined) {
          const responseJson = JSON.stringify(result.data);
          if (logId) {
            await logger.logResult(
              logId,
              result.recordCount,
              responseJson.length,
            );
          }
          return c.json({ success: true, data: result.data });
        }

        const responseText = result.message ?? "";
        if (logId) {
          await logger.logResult(
            logId,
            result.recordCount,
            responseText.length,
          );
        }
        return c.json({ success: true, message: result.message });
      } catch (err: unknown) {
        return c.json({ success: false, error: (err as Error).message }, 500);
      }
    }
  }

  // MCP transport for all other requests. The dispatch runs inside a per-request
  // context so tool handlers read THIS request's IP (finding C8), and a fresh
  // server + transport are built per request per the SDK's stateless pattern.
  return runWithRequestContext({ ipAddress }, async () => {
    const server = createMcpServer(
      supabase,
      logger,
      aiProvider,
      thoughtRepository,
      taskRepository,
    );
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });
});

Deno.serve(app.fetch);
