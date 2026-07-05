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

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  MCP_KEY,
  restUrl,
  serviceHeaders,
  SUPABASE_URL,
  uniqueToken,
} from "../helpers/mcp-client.ts";

const MCP_ENDPOINT =
  `${SUPABASE_URL}/functions/v1/terrestrial-brain-mcp?key=${MCP_KEY}`;

Deno.test("MCP request records its client IP in function_call_logs (C8)", async () => {
  const marker = `rctx-int-${uniqueToken()}`;
  const clientIp = "203.0.113.7";

  const response = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: marker,
      method: "tools/call",
      params: { name: "list_projects", arguments: { type: marker } },
    }),
  });
  await response.text();

  // Wait for the log row to be written (logging is awaited before the response
  // returns, but PostgREST read-after-write can lag a moment). Poll briefly on a
  // positive signal — the row's presence — rather than a fixed sleep.
  let rows: { input: string; ip_address: string | null }[] = [];
  const logQuery =
    `function_call_logs?function_name=eq.list_projects&input=ilike.*${marker}*&select=input,ip_address`;
  for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
    const logResponse = await fetch(restUrl(logQuery), { headers: serviceHeaders() });
    rows = await logResponse.json();
    if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert(rows.length >= 1, `expected a log row for marker ${marker}, found none`);
  assertEquals(rows[0].ip_address, clientIp);

  // Cleanup this test's log row(s).
  await fetch(
    restUrl(`function_call_logs?input=ilike.*${marker}*`),
    { method: "DELETE", headers: serviceHeaders() },
  );
});
