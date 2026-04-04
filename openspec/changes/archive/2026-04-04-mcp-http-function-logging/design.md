## Context

Terrestrial Brain's MCP server (30+ tools) and HTTP endpoints (6 handlers) currently have no structured logging of invocations. Errors are logged to Deno stdout (visible in Supabase dashboard logs) but there is no persistent, queryable record of what was called, with what input, or what errors occurred.

The server runs as a Supabase Edge Function (Deno). All requests pass through a single Hono `app.all("*")` handler in `index.ts`, which either routes to HTTP handlers or passes through to the MCP StreamableHTTPTransport. The secondary `ingest-thought` Edge Function calls the MCP server via HTTP.

### Current tool registration pattern

Each module exports a `register(server, supabase)` function that calls `server.registerTool(name, schema, handler)` for each tool. The handler is an async function that receives parsed params and returns `{ content: [...], isError?: boolean }`.

### Current HTTP handler pattern

HTTP handlers are inline in `index.ts` within the `app.all("*")` route. Each checks `url.pathname.endsWith(...)`, parses the request body, calls a handler function, and returns a JSON response.

## Goals / Non-Goals

**Goals:**
- Persistent, queryable log of every MCP tool and HTTP endpoint invocation
- Capture function name, input (serialized as text), timestamp, client IP (when available), and errors
- Log input *before* execution (so failed calls still have a record)
- Update the log row with error details *after* execution if an error occurred
- Minimal invasiveness — no changes to tool signatures or response formats
- Fire-and-forget logging — logging failures MUST NOT cause the actual tool/endpoint to fail

**Non-Goals:**
- Log rotation, retention, or cleanup
- Logging response/output data
- Execution duration tracking
- Real-time alerting or dashboards
- Logging MCP protocol overhead (initialize, notifications/initialized) — only actual tool calls

## Decisions

### 1. Database table design

**Choice:** Single `function_call_logs` table with columns:
- `id` (uuid, PK, default gen_random_uuid())
- `function_name` (text, not null) — tool name or HTTP endpoint path
- `function_type` (text, not null) — `'mcp'` or `'http'` to distinguish call types
- `input` (text) — JSON-serialized input params
- `called_at` (timestamptz, not null, default now())
- `error_details` (text, nullable) — populated only on error
- `ip_address` (text, nullable) — best-effort from headers

**Alternatives considered:**
- Separate tables for MCP vs HTTP: rejected because the schema is identical and a single table simplifies querying across both.
- JSONB for input: rejected because text is simpler, avoids JSON parse overhead on write, and the column is for human/debug inspection not querying.

**Index:** `called_at DESC` for chronological querying. No index on `function_name` initially (can add later if query patterns demand it).

**RLS:** Enable RLS with service-role-only access (matching existing table patterns).

### 2. Logging utility design

**Choice:** A single `logger.ts` module exporting two functions:

```typescript
interface FunctionCallLogger {
  logCall(functionName: string, functionType: 'mcp' | 'http', input: Record<string, unknown>, ipAddress?: string | null): Promise<string | null>;
  logError(logId: string, errorDetails: string): Promise<void>;
}
```

- `logCall()` inserts a row and returns the UUID (or null if the insert fails — fire-and-forget).
- `logError()` updates the row's `error_details` column. Also fire-and-forget.
- Both catch all errors internally and log to console — never throw.

**Why fire-and-forget:** Logging is observability infrastructure. A logging failure must never degrade the actual API response. If the log INSERT fails, the tool still runs normally.

### 3. MCP tool instrumentation approach

**Choice:** Wrapper function that wraps each tool handler.

Create a higher-order function `withLogging(toolName, handler, supabase, getIp)` that:
1. Calls `logCall()` with the tool name and input
2. Calls the original handler
3. If the response has `isError: true`, calls `logError()` with the error text
4. Returns the original response unchanged

Each `register()` function receives the logger and wraps each handler at registration time.

**Why wrapper over middleware:** MCP SDK's `server.registerTool` takes a handler directly — there's no middleware hook. A wrapper function is the cleanest approach without modifying the SDK.

### 4. HTTP endpoint instrumentation approach

**Choice:** Inline logging calls in `index.ts` at the start of each route handler block.

For each HTTP route block in the `app.all("*")` handler:
1. Call `logCall()` with the endpoint path and parsed body
2. If the handler returns an error response, call `logError()`

**Why inline over Hono middleware:** The HTTP routes aren't Hono sub-routes — they're if-statements inside a single `app.all("*")` handler. A Hono middleware wouldn't help. Inline calls in the existing try/catch blocks are minimal and clear.

### 5. IP address extraction

**Choice:** Helper function that checks headers in order:
1. `x-forwarded-for` (first IP in comma-separated list)
2. `x-real-ip`
3. `c.req.header("cf-connecting-ip")` (Cloudflare, used by Supabase)
4. Fall back to `null`

Supabase Edge Functions run behind a proxy, so the real client IP (if available) will be in forwarded headers. Connection-level remote address isn't reliably available in Deno.serve on Supabase.

### 6. Ingest-thought function

**Choice:** Add direct logging calls in the `ingest-thought` Edge Function's `processMessage()` function. Since this function calls the MCP server via HTTP, the MCP-side call will also be logged by the MCP server's own instrumentation. The ingest-thought log captures the Slack-side invocation.

The ingest-thought function has its own Supabase client, so it gets its own logger instance.

### 7. Test Strategy

This change is purely additive infrastructure (new table + logging calls). The logging is fire-and-forget and does not alter any existing behavior or response formats.

- **Unit tests:** Not applicable — this project has no unit test infrastructure for Edge Functions.
- **Integration tests:** Not applicable — the project has no integration test setup for Supabase Edge Functions.
- **Manual verification:** Deploy migration, invoke tools via MCP, verify rows appear in `function_call_logs` table.

## Risks / Trade-offs

- **Write amplification:** Every tool/endpoint call adds 1 INSERT (+ 1 UPDATE on error). For this personal knowledge system, volume is low enough that this is negligible.  
  → Mitigation: Fire-and-forget pattern means logging writes don't block responses.

- **Input size:** Large inputs (e.g., document content in `write_document`) will be stored as full text.  
  → Mitigation: Acceptable for a personal system. Can add truncation later if needed.

- **IP accuracy:** Supabase Edge Functions behind proxy may not always forward client IP.  
  → Mitigation: Best-effort extraction; column is nullable.

- **Migration deployment:** Table must exist before the updated Edge Functions are deployed.  
  → Mitigation: Run migration first, then deploy functions. Standard Supabase workflow.

## Open Questions

None — the design is straightforward enough to proceed.
