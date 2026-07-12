// Capability-probe helpers for red-by-design lifecycle tests (design D2).
//
// Some Step 7 rules need a brand-new MCP tool or a new column that does not
// exist yet. A test for such a rule must fail for a DOCUMENTED reason (the
// capability is absent), never an ambiguous crash. These probes give each such
// test a clean red anchor: "the tool is not registered" / "the column does not
// exist" — which Step 7 flips to green by adding the capability.

import { MCP_BASE, restUrl, serviceHeaders } from "../../helpers/mcp-client.ts";

/** The set of tool names the running MCP server currently registers. */
export async function toolNames(): Promise<string[]> {
  const response = await fetch(MCP_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/list",
      params: {},
    }),
  });
  const text = await response.text();
  const dataLine = text.startsWith("event:")
    ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim()
    : text;
  const parsed = JSON.parse(dataLine ?? "{}") as {
    result?: { tools?: { name: string }[] };
  };
  return (parsed.result?.tools ?? []).map((tool) => tool.name);
}

/** True if the MCP server registers a tool by this exact name. */
export async function hasTool(name: string): Promise<boolean> {
  return (await toolNames()).includes(name);
}

/**
 * True if `table` has a queryable `column`. Uses a bounded PostgREST select;
 * a missing column returns a 400 with a `column ... does not exist` body, so
 * this resolves false without throwing.
 */
export async function columnExists(
  table: string,
  column: string,
): Promise<boolean> {
  const response = await fetch(
    restUrl(`${table}?select=${column}&limit=1`),
    { headers: serviceHeaders() },
  );
  // Consume the body so Deno's op-sanitizer doesn't flag a leaked response.
  await response.body?.cancel();
  return response.ok;
}
