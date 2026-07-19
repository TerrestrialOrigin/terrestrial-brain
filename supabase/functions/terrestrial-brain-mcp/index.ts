import "@supabase/functions-js/edge-runtime.d.ts";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

import { register as registerThoughts } from "./tools/thoughts.ts";
import { register as registerProjects } from "./tools/projects.ts";
import { register as registerTasks } from "./tools/tasks.ts";
import { register as registerAIOutput } from "./tools/ai_output.ts";
import { register as registerQueries } from "./tools/queries.ts";
import { register as registerPeople } from "./tools/people.ts";
import { register as registerDocuments } from "./tools/documents.ts";
import { register as registerArchive } from "./tools/archive.ts";
import { register as registerForgetNote } from "./tools/forget_note.ts";
import {
  dispatchHttpRoute,
  HttpRouteDeps,
  matchHttpRoute,
} from "./http-routes.ts";
import { createFunctionCallLogger, extractIpAddress } from "./logger.ts";
import { runWithRequestContext } from "./requestContext.ts";
import { getConfiguredTimeZone, requireEnv } from "./env.ts";
import {
  buildCorsOptions,
  isKeyInQueryAllowed,
  parseAllowedOrigins,
  resolveProvidedKey,
} from "./security-config.ts";
import type { Database } from "./database.types.ts";
import { createAiProvider } from "./ai/factory.ts";
import {
  AI_METERED_FUNCTIONS,
  parseAiMonthlyLimit,
} from "./metering-config.ts";
import { SupabaseUsageMeter } from "./usage-meter.ts";
import { AiQuotaGate } from "./ai-quota.ts";
import { createDefaultExtractors } from "./extractors/pipeline.ts";

import type { ToolDeps } from "./tools/tool-deps.ts";
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

// Extractor set + user timezone: built/read ONCE here and injected through the
// tool deps (TOOL-14, EXTR-11) — handlers never construct extractors inline or
// read env mid-extraction.
const extractors = createDefaultExtractors();
const timeZone = getConfiguredTimeZone();

// The one shared dependency surface for the tool modules (CORE-7 / TOOL-11).
// Each register receives a Pick of exactly the fields it uses.
const toolDeps: ToolDeps = {
  supabase,
  logger,
  aiProvider,
  quotaGate,
  thoughtRepository,
  taskRepository,
  projectRepository,
  personRepository,
  documentRepository,
  aiOutputRepository,
  noteSnapshotRepository,
  archiveMaintenanceRepository,
  queryRepository,
  extractors,
  timeZone,
};

// ─── MCP Server factory ─────────────────────────────────────────────────────
// A fresh server is built per request (see the MCP branch below), following the
// MCP SDK's stateless-transport guidance: one server + transport per request
// rather than a single shared instance connected on every call. Tool
// registration lives here so no request mutates state shared with a concurrent
// request. `supabase` and `logger` are stateless singletons, so per-request
// construction adds only in-memory wiring, not a DB reconnect.

function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({
    name: "terrestrial-brain",
    version: "1.0.0",
  });

  // Each tool module receives exactly the seams it uses (its Pick<ToolDeps>);
  // only thoughts + documents run the extraction pipeline / embeddings and so
  // receive the AiProvider plus the repositories the pipeline seeds through.
  registerThoughts(server, deps);
  registerProjects(server, deps);
  registerTasks(server, deps);
  registerAIOutput(server, deps);
  registerQueries(server, deps);
  registerPeople(server, deps);
  registerDocuments(server, deps);
  registerForgetNote(server, deps);
  registerArchive(server, deps);

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

// Direct HTTP routes: the table, schemas, matcher, and dispatcher live in
// http-routes.ts with every dependency injected (Step 18 — CORE-5/6/10/14/17).
const httpRouteDeps: HttpRouteDeps = {
  supabase,
  aiProvider,
  thoughtRepository,
  taskRepository,
  projectRepository,
  personRepository,
  noteSnapshotRepository,
  aiOutputRepository,
  quotaGate,
  logger,
  extractors,
  timeZone,
  now: Date.now,
};

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

  // Direct HTTP routes (table-driven; see http-routes.ts). Matched exactly at
  // <base>/<name> on POST; everything else falls through to the MCP transport.
  if (context.req.method === "POST") {
    const route = matchHttpRoute(url.pathname);
    if (route) {
      const outcome = await dispatchHttpRoute({
        route,
        readBody: () => context.req.json(),
        deps: httpRouteDeps,
        ipAddress,
      });
      return context.json(outcome.payload, outcome.status);
    }
  }

  // MCP transport for all other requests. The dispatch runs inside a per-request
  // context so tool handlers read THIS request's IP (finding C8), and a fresh
  // server + transport are built per request per the SDK's stateless pattern.
  return runWithRequestContext({ ipAddress }, async () => {
    const server = createMcpServer(toolDeps);
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(context);
  });
});

Deno.serve(app.fetch);
