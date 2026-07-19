// Integration guard for finding C8 (fix-plan Step 11): a single MCP request's
// client IP is recorded in `function_call_logs`, proving the per-request
// server/transport factory and the AsyncLocalStorage-backed request context did
// not break end-to-end IP logging.
//
// The deterministic reproduction of the concurrent cross-attribution bug lives
// in tests/unit/request_context.test.ts — the local Supabase edge runtime cannot
// sustain the concurrency needed to force that race end-to-end (see the change's
// design.md, Decision 3), so this integration test guards the single-request
// path and the refactor, not the race itself.

import { assert } from "@std/assert";
import {
  mcpHeaders,
  restUrl,
  serviceHeaders,
  SUPABASE_URL,
  uniqueToken,
} from "../helpers/mcp-client.ts";

const MCP_ENDPOINT = `${SUPABASE_URL}/functions/v1/terrestrial-brain-mcp`;

Deno.test("MCP request records a validated, trusted-hop client IP in function_call_logs (C8/CORE-16)", async () => {
  const marker = `rctx-int-${uniqueToken()}`;
  // A client-forged x-forwarded-for element. CORE-16: the logger must take the
  // TRUSTED hop (the one the gateway appends LAST), never this spoofable value.
  const spoofedIp = "203.0.113.7";
  const clientIp = spoofedIp;

  const response = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: mcpHeaders({
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "x-forwarded-for": clientIp,
    }),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: marker,
      method: "tools/call",
      // The unique marker rides in `query` (a free-text arg) so the logged
      // `input` is uniquely identifiable. (It previously used `list_projects`'s
      // `type`, but that is now a validated enum — Step 24 — which would reject
      // an arbitrary marker before the call is ever logged.)
      params: { name: "search_thoughts", arguments: { query: marker } },
    }),
  });
  await response.text();

  // Wait for the log row to be written (logging is awaited before the response
  // returns, but PostgREST read-after-write can lag a moment). Poll briefly on a
  // positive signal — the row's presence — rather than a fixed sleep.
  let rows: { input: string; ip_address: string | null }[] = [];
  const logQuery =
    `function_call_logs?function_name=eq.search_thoughts&input=ilike.*${marker}*&select=input,ip_address`;
  for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
    const logResponse = await fetch(restUrl(logQuery), {
      headers: serviceHeaders(),
    });
    rows = await logResponse.json();
    if (rows.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  assert(
    rows.length >= 1,
    `expected a log row for marker ${marker}, found none`,
  );
  // The spoofable first hop must NOT be what lands in the forensic trail: the
  // gateway appends the true client IP as the LAST hop, and the logger stores
  // that trusted hop (shape-validated) or null — never the forged value.
  const storedIp = rows[0].ip_address;
  assert(
    storedIp !== spoofedIp,
    `logged ip_address must not be the client-forged XFF hop, got ${storedIp}`,
  );
  const IP_SHAPE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)$/;
  assert(
    storedIp === null || IP_SHAPE.test(storedIp),
    `logged ip_address must be a validated IP or null, got ${storedIp}`,
  );

  // Cleanup this test's log row(s).
  await fetch(
    restUrl(`function_call_logs?input=ilike.*${marker}*`),
    { method: "DELETE", headers: serviceHeaders() },
  );
});
