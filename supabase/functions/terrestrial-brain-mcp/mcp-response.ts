// ─── MCP tool response envelope ─────────────────────────────────────────────
// A single home for the success/error envelope that every tool handler returns.
// Previously this object was hand-built ~60 times across tools/*.ts (finding X1);
// building it here means a handler returns `textResult(...)` / `errorResult(...)`
// and never repeats the `{ content: [{ type: "text", text }], isError? }` shape.

/**
 * Result telemetry a row-returning handler reports to the logging decorator.
 * The decorator cannot know the true DB row count on its own (it only sees the
 * rendered text envelope), so the handler — the only code holding `data.length`
 * — threads it through here. Internal only: stripped before the client payload.
 */
export interface ResultMeta {
  /** Real number of DB rows this response conveys (0 for an empty read). */
  recordsReturned?: number;
  /** Ids of the returned entities (bounded, ids only — never content). */
  returnedIds?: string[];
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
  meta?: ResultMeta;
}

/**
 * Success envelope: one text block, no `isError` (absent ≡ not an error).
 * Pass `meta` from a row-returning handler to report its real returned-row
 * count / ids to the logger; it is attached ONLY when provided, so a bare
 * `textResult(text)` stays byte-for-byte `{ content: [...] }`.
 */
export function textResult(text: string, meta?: ResultMeta): McpToolResult {
  const result: McpToolResult = { content: [{ type: "text", text }] };
  if (meta) {
    result.meta = meta;
  }
  return result;
}

/** Error envelope: one text block, `isError: true`. */
export function errorResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
