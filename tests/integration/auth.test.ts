import { assertEquals } from "@std/assert";

// Auth accept/deny matrix for the header-based-auth change, updated for the
// edge-security-residual change (Step 9): the ?key= query-param fallback is now
// rejected by default (TB_ALLOW_KEY_IN_QUERY is unset in the test stack), and
// CORS is locked to an allowlist (TB_ALLOWED_ORIGINS in the test stack's
// supabase/functions/.env). These are real HTTP requests against the running
// local stack — no mocks.

const MCP_BASE = "http://localhost:55421/functions/v1/terrestrial-brain-mcp";
const VALID_KEY = "dev-test-key-123";

const DISALLOWED_ORIGIN = "https://evil.example";

interface AuthCallOptions {
  headerKey?: string;
  queryKey?: string;
  origin?: string;
}

function buildUrl(path: string, options: AuthCallOptions): string {
  const url = new URL(`${MCP_BASE}${path}`);
  if (options.queryKey !== undefined) {
    url.searchParams.set("key", options.queryKey);
  }
  return url.toString();
}

function buildHeaders(options: AuthCallOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (options.headerKey !== undefined) {
    headers["x-tb-key"] = options.headerKey;
  }
  if (options.origin !== undefined) {
    headers["Origin"] = options.origin;
  }
  return headers;
}

/** POST an MCP tools/list request to the server root; returns the HTTP status. */
async function callMcpRoot(options: AuthCallOptions): Promise<number> {
  const response = await fetch(buildUrl("", options), {
    method: "POST",
    headers: buildHeaders(options),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/list",
      params: {},
    }),
  });
  await response.body?.cancel();
  return response.status;
}

/** POST to the direct /get-pending-ai-output-metadata route; returns the HTTP status. */
async function callDirectRoute(options: AuthCallOptions): Promise<number> {
  const response = await fetch(
    buildUrl("/get-pending-ai-output-metadata", options),
    {
      method: "POST",
      headers: buildHeaders(options),
    },
  );
  await response.body?.cancel();
  return response.status;
}

/** Assert a 401 with the canonical error body. */
async function assertUnauthorized(options: AuthCallOptions): Promise<void> {
  const response = await fetch(buildUrl("", options), {
    method: "POST",
    headers: buildHeaders(options),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, "Invalid or missing access key");
}

// ─── Accept cases ─────────────────────────────────────────────────────────────

Deno.test("auth: valid x-tb-key header is accepted at MCP root", async () => {
  const status = await callMcpRoot({ headerKey: VALID_KEY });
  assertEquals(status, 200);
});

Deno.test("auth: valid x-tb-key header is accepted on a direct route", async () => {
  const status = await callDirectRoute({ headerKey: VALID_KEY });
  assertEquals(status, 200);
});

Deno.test("auth: valid header wins over an invalid query param", async () => {
  const status = await callMcpRoot({
    headerKey: VALID_KEY,
    queryKey: "wrong-key",
  });
  assertEquals(status, 200);
});

// ─── Deny cases (GATE 1 denial coverage) ──────────────────────────────────────

Deno.test("auth: missing credentials are rejected with 401", async () => {
  await assertUnauthorized({});
});

Deno.test("auth: wrong header key is rejected with 401", async () => {
  await assertUnauthorized({ headerKey: "totally-wrong-key" });
});

Deno.test("auth: prefix of the real key is rejected with 401", async () => {
  await assertUnauthorized({
    headerKey: VALID_KEY.slice(0, VALID_KEY.length - 1),
  });
});

Deno.test("auth: key with an extra suffix is rejected with 401", async () => {
  await assertUnauthorized({ headerKey: `${VALID_KEY}x` });
});

Deno.test("auth: empty header key is rejected with 401", async () => {
  await assertUnauthorized({ headerKey: "" });
});

Deno.test("auth: invalid header is rejected even when the query param is valid", async () => {
  await assertUnauthorized({ headerKey: "wrong-key", queryKey: VALID_KEY });
});

Deno.test("auth: wrong query param without header is rejected with 401", async () => {
  await assertUnauthorized({ queryKey: "wrong-key" });
});

// The security-residual default change: even a *valid* ?key= is rejected when
// the header is absent and TB_ALLOW_KEY_IN_QUERY is off (the shipping default).
Deno.test("auth: valid ?key= query param without header is rejected by default (401)", async () => {
  await assertUnauthorized({ queryKey: VALID_KEY });
});

Deno.test("auth: direct route rejects missing credentials with 401", async () => {
  const status = await callDirectRoute({});
  assertEquals(status, 401);
});

// ─── CORS: non-browser auth is never origin-gated ─────────────────────────────
// The app's CORS *header* behavior (reflect-vs-deny) is asserted in-process
// against the real middleware in tests/unit/cors-middleware.test.ts, because the
// local Supabase dev gateway (Kong) injects permissive `*` on /functions/v1/*
// and masks the app on this network path. What IS observable and important here:
// CORS never gates a non-browser client — auth is the real gate.

Deno.test("cors: a valid header request still authenticates regardless of origin (non-browser path)", async () => {
  const status = await callMcpRoot({
    headerKey: VALID_KEY,
    origin: DISALLOWED_ORIGIN,
  });
  assertEquals(status, 200);
});
