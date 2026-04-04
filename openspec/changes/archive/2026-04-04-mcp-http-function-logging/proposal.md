## Why

There is currently no visibility into which MCP tools and HTTP endpoints are being called, what inputs they receive, when errors occur, or where requests originate. Adding structured function call logging enables debugging, usage analytics, error tracking, and audit trails for all API activity.

## What Changes

- **New database table** `function_call_logs` to store: function name, input text, call timestamp, error details (nullable), and client IP address (nullable).
- **New logging utility module** providing `logFunctionCall()` and `logFunctionCallError()` helpers that insert/update log rows via Supabase.
- **MCP tool instrumentation**: All 30+ registered MCP tools across 7 modules (thoughts, projects, tasks, people, documents, ai_output, queries) will log invocations before execution and capture errors after.
- **HTTP endpoint instrumentation**: All 6 HTTP handlers (ingest-note, get-pending-ai-output, get-pending-ai-output-metadata, fetch-ai-output-content, mark-ai-output-picked-up, reject-ai-output) will log invocations before execution and capture errors after.
- **Ingest-thought function instrumentation**: The Slack bot edge function will also log its invocations.
- **IP address extraction** from request headers (`x-forwarded-for`, `x-real-ip`, or Deno connection info).

## Non-goals

- Log rotation, retention policies, or automatic cleanup of old log entries (can be added later).
- Real-time alerting or dashboards based on log data.
- Logging response content or output — only inputs and errors are captured.
- Performance profiling or execution duration tracking.

## Capabilities

### New Capabilities
- `function-call-logging`: Database-backed logging of all MCP tool and HTTP endpoint invocations, capturing function name, input, timestamp, errors, and client IP.

### Modified Capabilities
_(No existing spec-level behavior changes — this is purely additive instrumentation.)_

## Impact

- **Database**: New `function_call_logs` table via migration. Every MCP/HTTP call adds one INSERT; errors add one UPDATE. Moderate write volume increase.
- **Code**: New `logger.ts` utility module. All 7 MCP tool modules and the HTTP handler module in `ai_output.ts` gain logging wrappers. `index.ts` updated to pass request context (IP) to handlers.
- **Edge Functions**: Both `terrestrial-brain-mcp` and `ingest-thought` functions modified.
- **Dependencies**: No new external dependencies — uses existing Supabase client.
- **Affected files**:
  - `supabase/migrations/` — new migration
  - `supabase/functions/terrestrial-brain-mcp/logger.ts` — new file
  - `supabase/functions/terrestrial-brain-mcp/tools/*.ts` — all 7 modules
  - `supabase/functions/terrestrial-brain-mcp/index.ts` — IP extraction, request context
  - `supabase/functions/ingest-thought/index.ts` — logging integration
