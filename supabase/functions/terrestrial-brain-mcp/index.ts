import "@supabase/functions-js/edge-runtime.d.ts";
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
import { register as registerArchive } from "./tools/archive.ts";
import {
  forgetNote,
  formatForgetOutcome,
  register as registerForgetNote,
} from "./tools/forget_note.ts";
import {
  createFunctionCallLogger,
  extractIpAddress,
  FunctionCallLogger,
} from "./logger.ts";
import { runWithRequestContext } from "./requestContext.ts";
import { requireEnv } from "./env.ts";
import {
  buildCorsOptions,
  isKeyInQueryAllowed,
  parseAllowedOrigins,
  resolveProvidedKey,
} from "./security-config.ts";
import type { Database } from "./database.types.ts";
import type { AppSupabaseClient } from "./supabase-client.ts";
import type { AiProvider } from "./ai/ai-provider.ts";
import { createAiProvider } from "./ai/factory.ts";
import {
  AI_METERED_FUNCTIONS,
  parseAiMonthlyLimit,
} from "./metering-config.ts";
import { SupabaseUsageMeter } from "./usage-meter.ts";
import { AiQuotaGate, quotaExceededMessage } from "./ai-quota.ts";
import type { ThoughtRepository } from "./repositories/thought-repository.ts";
import type { TaskRepository } from "./repositories/task-repository.ts";
import type { ProjectRepository } from "./repositories/project-repository.ts";
import type { PersonRepository } from "./repositories/person-repository.ts";
import type { DocumentRepository } from "./repositories/document-repository.ts";
import type { AiOutputRepository } from "./repositories/ai-output-repository.ts";
import type { NoteSnapshotRepository } from "./repositories/note-snapshot-repository.ts";
import type { ArchiveMaintenanceRepository } from "./repositories/archive-maintenance-repository.ts";
import type { QueryRepository } from "./repositories/query-repository.ts";
import { SupabaseThoughtRepository } from "./repositories/supabase-thought-repository.ts";
import { SupabaseTaskRepository } from "./repositories/supabase-task-repository.ts";
import { SupabaseProjectRepository } from "./repositories/supabase-project-repository.ts";
import { SupabasePersonRepository } from "./repositories/supabase-person-repository.ts";
import { SupabaseDocumentRepository } from "./repositories/supabase-document-repository.ts";
import { SupabaseAiOutputRepository } from "./repositories/supabase-ai-output-repository.ts";
import { SupabaseNoteSnapshotRepository } from "./repositories/supabase-note-snapshot-repository.ts";
import { SupabaseQueryRepository } from "./repositories/supabase-query-repository.ts";
import { SupabaseArchiveMaintenanceRepository } from "./repositories/supabase-archive-maintenance-repository.ts";

// Composition-root secrets: validated at cold start so a missing var fails the
// boot loudly (named in the error) rather than surfacing later as broken auth or
// a corrupt outbound request (finding X5).
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const MCP_ACCESS_KEY = requireEnv("MCP_ACCESS_KEY");

// Optional edge-boundary security switches (Step 9, edge-security-residual).
// Both default to the most-restrictive posture: no cross-origin access and
// header-only auth. Read once here (parse, don't cast) and passed into the
// middleware config and request handler below.
const ALLOWED_ORIGINS = parseAllowedOrigins(
  Deno.env.get("TB_ALLOWED_ORIGINS"),
);
const ALLOW_KEY_IN_QUERY = isKeyInQueryAllowed(
  Deno.env.get("TB_ALLOW_KEY_IN_QUERY"),
);

const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
);
const logger = createFunctionCallLogger(supabase);
// Repository seams over the `thoughts` / `tasks` tables (fix-plan Step 16).
// Stateless wrappers over the shared client — constructed once and injected.
const thoughtRepository = new SupabaseThoughtRepository(supabase);
const taskRepository = new SupabaseTaskRepository(supabase);
// Remaining entity + composite-read seams (fix-plan Step 17). Stateless wrappers
// over the shared client — constructed once and injected.
const projectRepository = new SupabaseProjectRepository(supabase);
const personRepository = new SupabasePersonRepository(supabase);
const documentRepository = new SupabaseDocumentRepository(supabase);
const aiOutputRepository = new SupabaseAiOutputRepository(supabase);
const noteSnapshotRepository = new SupabaseNoteSnapshotRepository(supabase);
const queryRepository = new SupabaseQueryRepository(supabase);
const archiveMaintenanceRepository = new SupabaseArchiveMaintenanceRepository(
  supabase,
);
// The single AiProvider seam (fix-plan Step 15). Constructed once here and
// injected into consumers; the provider is stateless, so one instance is safe to
// share across requests. The factory selects the live OpenRouter provider or the
// deterministic FakeAiProvider based on TB_AI_PROVIDER (Step 22).
const aiProvider = createAiProvider();

// Managed-AI monthly quota (Step 15, managed-ai-metering). Read + parsed ONCE
// here (parse, don't cast): unset/invalid/≤0 ⇒ unlimited — the safe self-host
// default, so the gate short-circuits to "allowed" with no usage query. When a
// positive limit is set (a hosted project secret), the gate counts AI-metered
// calls this UTC month from function_call_logs and refuses over-quota operations
// before any AI call.
const aiMonthlyLimit = parseAiMonthlyLimit(Deno.env.get("TB_AI_MONTHLY_LIMIT"));
const usageMeter = new SupabaseUsageMeter(supabase, AI_METERED_FUNCTIONS);
const quotaGate = new AiQuotaGate(aiMonthlyLimit, usageMeter);

// ─── MCP Server factory ─────────────────────────────────────────────────────
// A fresh server is built per request (see the MCP branch below), following the
// MCP SDK's stateless-transport guidance: one server + transport per request
// rather than a single shared instance connected on every call. Tool
// registration lives here so no request mutates state shared with a concurrent
// request. `supabase` and `logger` are stateless singletons, so per-request
// construction adds only in-memory wiring, not a DB reconnect.

function createMcpServer(
  supabaseClient: AppSupabaseClient,
  callLogger: FunctionCallLogger,
  provider: AiProvider,
  gate: AiQuotaGate,
  repos: {
    thought: ThoughtRepository;
    task: TaskRepository;
    project: ProjectRepository;
    person: PersonRepository;
    document: DocumentRepository;
    aiOutput: AiOutputRepository;
    query: QueryRepository;
    noteSnapshot: NoteSnapshotRepository;
    archiveMaintenance: ArchiveMaintenanceRepository;
  },
): McpServer {
  const server = new McpServer({
    name: "terrestrial-brain",
    version: "1.0.0",
  });

  // Each tool module receives exactly the seams it uses; only thoughts +
  // documents run the extraction pipeline / embeddings and so receive the
  // AiProvider plus the project/person repositories the pipeline seeds through.
  registerThoughts(
    server,
    supabaseClient,
    callLogger,
    provider,
    repos.thought,
    repos.task,
    repos.project,
    repos.person,
    gate,
  );
  registerProjects(
    server,
    supabaseClient,
    callLogger,
    repos.project,
    repos.task,
  );
  registerTasks(server, supabaseClient, callLogger, repos.task);
  registerAIOutput(
    server,
    supabaseClient,
    callLogger,
    repos.aiOutput,
    repos.task,
  );
  registerQueries(server, supabaseClient, callLogger, repos.query);
  registerPeople(server, supabaseClient, callLogger, repos.person, repos.task);
  registerDocuments(
    server,
    supabaseClient,
    callLogger,
    provider,
    repos.task,
    repos.project,
    repos.person,
    repos.document,
    repos.thought,
  );
  registerForgetNote(
    server,
    callLogger,
    repos.noteSnapshot,
    repos.thought,
  );
  registerArchive(server, callLogger, repos.archiveMaintenance);

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
  supabase: AppSupabaseClient;
  aiProvider: AiProvider;
  thoughtRepository: ThoughtRepository;
  taskRepository: TaskRepository;
  projectRepository: ProjectRepository;
  personRepository: PersonRepository;
  noteSnapshotRepository: NoteSnapshotRepository;
  aiOutputRepository: AiOutputRepository;
  body: Record<string, unknown>;
}

type HttpRouteResult =
  | { ok: true; data?: unknown; message?: string; recordCount: number }
  | { ok: false; error: string; status: 400 | 429 | 500 };

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
      {
        supabase,
        aiProvider,
        thoughtRepository,
        taskRepository,
        projectRepository,
        personRepository,
        noteSnapshotRepository,
        body,
      },
    ) => {
      const content = body.content;
      if (
        !content || typeof content !== "string" || content.trim().length === 0
      ) {
        return { ok: false, error: "content is required", status: 400 };
      }
      // Metered AI operation (Step 15): refused before any embedding/extraction
      // when over quota, with a distinct 429 (never a silent success/skip).
      const quota = await quotaGate.check(Date.now());
      if (!quota.allowed) {
        return { ok: false, error: quotaExceededMessage(quota), status: 429 };
      }
      const result = await handleIngestNote(
        supabase,
        aiProvider,
        thoughtRepository,
        taskRepository,
        projectRepository,
        personRepository,
        noteSnapshotRepository,
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
    suffix: "/forget-note",
    logName: "forget-note",
    parseBody: true,
    handle: async ({ noteSnapshotRepository, thoughtRepository, body }) => {
      const noteId = body.note_id;
      if (!noteId || typeof noteId !== "string" || noteId.trim().length === 0) {
        return { ok: false, error: "note_id is required", status: 400 };
      }
      const outcome = await forgetNote(
        noteSnapshotRepository,
        thoughtRepository,
        noteId,
      );
      if (!outcome.ok) {
        return { ok: false, error: outcome.error, status: 500 };
      }
      return {
        ok: true,
        message: formatForgetOutcome(noteId, outcome),
        recordCount: outcome.thoughtsDeleted +
          (outcome.snapshotExisted ? 1 : 0),
      };
    },
  },
  {
    suffix: "/get-pending-ai-output",
    logName: "get-pending-ai-output",
    parseBody: false,
    handle: async ({ aiOutputRepository }) =>
      dataOutcome(await handleGetPendingAIOutput(aiOutputRepository)),
  },
  {
    suffix: "/get-pending-ai-output-metadata",
    logName: "get-pending-ai-output-metadata",
    parseBody: false,
    handle: async ({ aiOutputRepository }) =>
      dataOutcome(await handleGetPendingAIOutputMetadata(aiOutputRepository)),
  },
  {
    suffix: "/fetch-ai-output-content",
    logName: "fetch-ai-output-content",
    parseBody: true,
    handle: async ({ aiOutputRepository, body }) => {
      const ids = body.ids;
      if (!ids || !Array.isArray(ids)) {
        return { ok: false, error: IDS_REQUIRED, status: 400 };
      }
      return dataOutcome(
        await handleFetchAIOutputContent(aiOutputRepository, ids as string[]),
      );
    },
  },
  {
    suffix: "/mark-ai-output-picked-up",
    logName: "mark-ai-output-picked-up",
    parseBody: true,
    handle: async ({ aiOutputRepository, body }) => {
      const ids = body.ids;
      if (!ids || !Array.isArray(ids)) {
        return { ok: false, error: IDS_REQUIRED, status: 400 };
      }
      const result = await handleMarkAIOutputPickedUp(
        aiOutputRepository,
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
    handle: async ({ aiOutputRepository, body }) => {
      const ids = body.ids;
      if (!ids || !Array.isArray(ids)) {
        return { ok: false, error: IDS_REQUIRED, status: 400 };
      }
      const result = await handleRejectAIOutput(
        aiOutputRepository,
        ids as string[],
      );
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
  // Default-deny CORS: only origins in TB_ALLOWED_ORIGINS are reflected; an
  // unset allowlist denies every cross-origin request. Never the wildcard `*`.
  // CORS is a browser-side control only — the access-key check below is the real
  // authorization gate for all clients (T7). NOTE: the local Supabase dev
  // gateway (Kong) injects its own permissive CORS on /functions/v1/*, which
  // masks this locally; hosted deployments are app-authoritative (see
  // security-config tests, which assert this middleware directly).
  cors(buildCorsOptions(ALLOWED_ORIGINS)),
);

// ─── Unified handler: route by URL path ──────────────────────────────────────
// Supabase Edge Functions may not pass subpaths to Hono's router, so we check
// the raw URL to distinguish /ingest-note from MCP requests.

app.all("*", async (context) => {
  const url = new URL(context.req.url);
  // x-tb-key header is the primary and default mechanism. The deprecated ?key=
  // fallback is consulted only when TB_ALLOW_KEY_IN_QUERY=1 (keys in URLs leak
  // through proxy/CDN/edge logs). The header always wins when present (T2).
  const providedKey = resolveProvidedKey({
    headerKey: context.req.header("x-tb-key"),
    queryKey: url.searchParams.get("key"),
    allowKeyInQuery: ALLOW_KEY_IN_QUERY,
  });
  if (!providedKey || !(await accessKeyMatches(providedKey, MCP_ACCESS_KEY))) {
    return context.json({ error: "Invalid or missing access key" }, 401);
  }

  const ipAddress = extractIpAddress(context.req.raw.headers);

  // Direct HTTP routes (table-driven; see HTTP_ROUTES above). Matched by path
  // suffix on POST; everything else falls through to the MCP transport below.
  if (context.req.method === "POST") {
    const route = HTTP_ROUTES.find((httpRoute) =>
      url.pathname.endsWith(httpRoute.suffix)
    );
    if (route) {
      try {
        // parseBody routes read JSON up front; malformed JSON throws here and is
        // caught below as a 500 (matching the previous per-block behavior), and
        // no call is logged — the parse fails before logCall, as before.
        const body: Record<string, unknown> = route.parseBody
          ? await context.req.json()
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
          projectRepository,
          personRepository,
          noteSnapshotRepository,
          aiOutputRepository,
          body,
        });

        if (!result.ok) {
          if (logId) await logger.logResult(logId, 0, 0, result.error);
          return context.json(
            { success: false, error: result.error },
            result.status,
          );
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
          return context.json({ success: true, data: result.data });
        }

        const responseText = result.message ?? "";
        if (logId) {
          await logger.logResult(
            logId,
            result.recordCount,
            responseText.length,
          );
        }
        return context.json({ success: true, message: result.message });
      } catch (error: unknown) {
        return context.json(
          { success: false, error: (error as Error).message },
          500,
        );
      }
    }
  }

  // MCP transport for all other requests. The dispatch runs inside a per-request
  // context so tool handlers read THIS request's IP (finding C8), and a fresh
  // server + transport are built per request per the SDK's stateless pattern.
  return runWithRequestContext({ ipAddress }, async () => {
    const server = createMcpServer(supabase, logger, aiProvider, quotaGate, {
      thought: thoughtRepository,
      task: taskRepository,
      project: projectRepository,
      person: personRepository,
      document: documentRepository,
      aiOutput: aiOutputRepository,
      query: queryRepository,
      noteSnapshot: noteSnapshotRepository,
      archiveMaintenance: archiveMaintenanceRepository,
    });
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(context);
  });
});

Deno.serve(app.fetch);
