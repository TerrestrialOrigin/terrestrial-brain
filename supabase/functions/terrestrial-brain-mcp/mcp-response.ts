// ─── MCP tool response envelope ─────────────────────────────────────────────
// A single home for the success/error envelope that every tool handler returns.
// Previously this object was hand-built ~60 times across tools/*.ts (finding X1);
// building it here means a handler returns `textResult(...)` / `errorResult(...)`
// and never repeats the `{ content: [{ type: "text", text }], isError? }` shape.

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Success envelope: one text block, no `isError` (absent ≡ not an error). */
export function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

/** Error envelope: one text block, `isError: true`. */
export function errorResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
