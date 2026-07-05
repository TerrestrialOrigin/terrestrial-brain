// Shared test-client helpers for the Terrestrial Brain integration suite.
//
// Every integration test file imports its MCP-calling helpers and Supabase
// connection constants from here instead of re-declaring them inline. The
// helpers are behaviorally identical to the copies they replaced: `callTool`
// returns the tool's text content and throws on `isError`; `callToolRaw`
// returns `{ text, isError }` without throwing; the HTTP helpers post to a
// named sub-route. SSE (`event:`/`data:`) responses are parsed exactly as
// the originals did.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Connection constants ────────────────────────────────────────────────────

export const SUPABASE_URL = "http://localhost:54321";

// Local-stack service-role key (from `supabase status`). Bypasses RLS — used by
// tests to verify DB side-effects and to clean up fixtures directly via REST.
export const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Deprecated `?key=` query-param access key still accepted by the edge function.
export const MCP_KEY = "dev-test-key-123";

export const MCP_BASE =
  `${SUPABASE_URL}/functions/v1/terrestrial-brain-mcp?key=${MCP_KEY}`;

export function httpUrl(endpoint: string): string {
  return `${SUPABASE_URL}/functions/v1/terrestrial-brain-mcp/${endpoint}?key=${MCP_KEY}`;
}

// ─── MCP tool callers ────────────────────────────────────────────────────────

async function postTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(MCP_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const text = await res.text();
  const parsed = text.startsWith("event:")
    ? parseSse(text)
    : JSON.parse(text);
  return {
    text: parsed.result?.content?.[0]?.text || "",
    isError: !!parsed.result?.isError,
  };
}

function parseSse(text: string): { result?: { content?: { text?: string }[]; isError?: boolean } } {
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error("No data in SSE response");
  return JSON.parse(dataLine.slice(5).trim());
}

/** Call an MCP tool and return its text content; throws on tool errors. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { text, isError } = await postTool(name, args);
  if (isError) throw new Error(text || "Tool error");
  return text;
}

/** Call an MCP tool and return { text, isError } without throwing. */
export async function callToolRaw(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  return await postTool(name, args);
}

// ─── HTTP sub-route callers ──────────────────────────────────────────────────

/** POST to a named HTTP sub-route; returns the parsed JSON body. */
export async function callHTTP(
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(httpUrl(endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return await response.json();
}

/** POST to a named HTTP sub-route; returns the status alongside the JSON body. */
export async function callHTTPWithStatus(
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(httpUrl(endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

/** POST to the ingest-note HTTP route; returns the message; throws on failure. */
export async function callIngestNote(args: {
  content: string;
  title?: string;
  note_id?: string;
}): Promise<string> {
  const res = await fetch(httpUrl("ingest-note"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!body.success) throw new Error(body.error || "Ingest failed");
  return body.message || "";
}

// ─── Direct REST / DB access (service role) ──────────────────────────────────

/** Service-role auth headers for direct PostgREST calls. */
export function serviceHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...(extra ?? {}),
  };
}

/** Build a PostgREST URL, e.g. restUrl("thoughts?id=eq.123"). */
export function restUrl(path: string): string {
  return `${SUPABASE_URL}/rest/v1/${path}`;
}

/** A service-role supabase-js client for tests that use the SDK directly. */
export function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ─── Fixture-naming utility ──────────────────────────────────────────────────

let fixtureCounter = 0;

/**
 * A collision-resistant unique token for fixture names, so each test owns
 * distinctly-named rows and tests never depend on execution order.
 */
export function uniqueToken(): string {
  fixtureCounter += 1;
  return `${fixtureCounter}-${crypto.randomUUID()}`;
}

/** A unique fixture name with a human-readable prefix. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${uniqueToken()}`;
}
