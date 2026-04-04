import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

import { register as registerThoughts, handleIngestNote } from "./tools/thoughts.ts";
import { register as registerProjects } from "./tools/projects.ts";
import { register as registerTasks } from "./tools/tasks.ts";
import {
  register as registerAIOutput,
  handleGetPendingAIOutput,
  handleGetPendingAIOutputMetadata,
  handleFetchAIOutputContent,
  handleMarkAIOutputPickedUp,
  handleRejectAIOutput,
} from "./tools/ai_output.ts";
import { register as registerQueries } from "./tools/queries.ts";
import { register as registerPeople } from "./tools/people.ts";
import { register as registerDocuments } from "./tools/documents.ts";
import { createFunctionCallLogger, extractIpAddress, setCurrentRequestIp } from "./logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const logger = createFunctionCallLogger(supabase);

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

registerThoughts(server, supabase, logger);
registerProjects(server, supabase, logger);
registerTasks(server, supabase, logger);
registerAIOutput(server, supabase, logger);
registerQueries(server, supabase, logger);
registerPeople(server, supabase, logger);
registerDocuments(server, supabase, logger);

// ─── Hono App with Auth Check ─────────────────────────────────────────────────

const app = new Hono();

app.use("*", cors({
  origin: "*",
  allowMethods: ["POST", "GET", "OPTIONS"],
  allowHeaders: ["Content-Type", "x-brain-key"],
}));

// ─── Unified handler: route by URL path ──────────────────────────────────────
// Supabase Edge Functions may not pass subpaths to Hono's router, so we check
// the raw URL to distinguish /ingest-note from MCP requests.

app.all("*", async (c) => {
  const url = new URL(c.req.url);
  const provided = c.req.header("x-brain-key") || url.searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  const ipAddress = extractIpAddress(c.req.raw.headers);

  // Direct HTTP route for ingest-note (not MCP)
  if (url.pathname.endsWith("/ingest-note") && c.req.method === "POST") {
    try {
      const body = await c.req.json();
      const logId = await logger.logCall("ingest-note", "http", body || {}, ipAddress);
      const content = body?.content;
      if (!content || typeof content !== "string" || content.trim().length === 0) {
        if (logId) await logger.logResult(logId, 0, 0, "content is required");
        return c.json({ success: false, error: "content is required" }, 400);
      }

      const result = await handleIngestNote(supabase, {
        content,
        title: body.title,
        note_id: body.note_id,
      });

      if (result.success) {
        const responseText = result.message || "";
        if (logId) await logger.logResult(logId, 1, responseText.length);
        return c.json({ success: true, message: result.message });
      } else {
        if (logId) await logger.logResult(logId, 0, 0, result.error || "Unknown error");
        return c.json({ success: false, error: result.error }, 500);
      }
    } catch (err: unknown) {
      return c.json({ success: false, error: (err as Error).message }, 500);
    }
  }

  // Direct HTTP route for get-pending-ai-output
  if (url.pathname.endsWith("/get-pending-ai-output") && c.req.method === "POST") {
    try {
      const logId = await logger.logCall("get-pending-ai-output", "http", {}, ipAddress);
      const result = await handleGetPendingAIOutput(supabase);
      if (result.error) {
        if (logId) await logger.logResult(logId, 0, 0, result.error);
        return c.json({ success: false, error: result.error }, 500);
      }
      const responseJson = JSON.stringify(result.data);
      const recordCount = Array.isArray(result.data) ? result.data.length : 1;
      if (logId) await logger.logResult(logId, recordCount, responseJson.length);
      return c.json({ success: true, data: result.data });
    } catch (err: unknown) {
      return c.json({ success: false, error: (err as Error).message }, 500);
    }
  }

  // Direct HTTP route for get-pending-ai-output-metadata
  if (url.pathname.endsWith("/get-pending-ai-output-metadata") && c.req.method === "POST") {
    try {
      const logId = await logger.logCall("get-pending-ai-output-metadata", "http", {}, ipAddress);
      const result = await handleGetPendingAIOutputMetadata(supabase);
      if (result.error) {
        if (logId) await logger.logResult(logId, 0, 0, result.error);
        return c.json({ success: false, error: result.error }, 500);
      }
      const responseJson = JSON.stringify(result.data);
      const recordCount = Array.isArray(result.data) ? result.data.length : 1;
      if (logId) await logger.logResult(logId, recordCount, responseJson.length);
      return c.json({ success: true, data: result.data });
    } catch (err: unknown) {
      return c.json({ success: false, error: (err as Error).message }, 500);
    }
  }

  // Direct HTTP route for fetch-ai-output-content
  if (url.pathname.endsWith("/fetch-ai-output-content") && c.req.method === "POST") {
    try {
      const body = await c.req.json();
      const logId = await logger.logCall("fetch-ai-output-content", "http", body || {}, ipAddress);
      const ids = body?.ids;
      if (!ids || !Array.isArray(ids)) {
        if (logId) await logger.logResult(logId, 0, 0, "ids array is required");
        return c.json({ success: false, error: "ids array is required" }, 400);
      }
      const result = await handleFetchAIOutputContent(supabase, ids);
      if (result.error) {
        if (logId) await logger.logResult(logId, 0, 0, result.error);
        return c.json({ success: false, error: result.error }, 500);
      }
      const responseJson = JSON.stringify(result.data);
      const recordCount = Array.isArray(result.data) ? result.data.length : 1;
      if (logId) await logger.logResult(logId, recordCount, responseJson.length);
      return c.json({ success: true, data: result.data });
    } catch (err: unknown) {
      return c.json({ success: false, error: (err as Error).message }, 500);
    }
  }

  // Direct HTTP route for mark-ai-output-picked-up
  if (url.pathname.endsWith("/mark-ai-output-picked-up") && c.req.method === "POST") {
    try {
      const body = await c.req.json();
      const logId = await logger.logCall("mark-ai-output-picked-up", "http", body || {}, ipAddress);
      const ids = body?.ids;
      if (!ids || !Array.isArray(ids)) {
        if (logId) await logger.logResult(logId, 0, 0, "ids array is required");
        return c.json({ success: false, error: "ids array is required" }, 400);
      }
      const result = await handleMarkAIOutputPickedUp(supabase, ids);
      if (result.error) {
        if (logId) await logger.logResult(logId, 0, 0, result.error);
        return c.json({ success: false, error: result.error }, 500);
      }
      const responseText = result.message || "";
      if (logId) await logger.logResult(logId, ids.length, responseText.length);
      return c.json({ success: true, message: result.message });
    } catch (err: unknown) {
      return c.json({ success: false, error: (err as Error).message }, 500);
    }
  }

  // Direct HTTP route for reject-ai-output
  if (url.pathname.endsWith("/reject-ai-output") && c.req.method === "POST") {
    try {
      const body = await c.req.json();
      const logId = await logger.logCall("reject-ai-output", "http", body || {}, ipAddress);
      const ids = body?.ids;
      if (!ids || !Array.isArray(ids)) {
        if (logId) await logger.logResult(logId, 0, 0, "ids array is required");
        return c.json({ success: false, error: "ids array is required" }, 400);
      }
      const result = await handleRejectAIOutput(supabase, ids);
      if (result.error) {
        if (logId) await logger.logResult(logId, 0, 0, result.error);
        return c.json({ success: false, error: result.error }, 500);
      }
      const responseText = result.message || "";
      if (logId) await logger.logResult(logId, ids.length, responseText.length);
      return c.json({ success: true, message: result.message });
    } catch (err: unknown) {
      return c.json({ success: false, error: (err as Error).message }, 500);
    }
  }

  // MCP transport for all other requests
  setCurrentRequestIp(ipAddress);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
