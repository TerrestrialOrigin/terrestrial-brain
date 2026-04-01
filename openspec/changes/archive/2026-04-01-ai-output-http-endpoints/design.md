## Context

The Terrestrial Brain MCP edge function currently exposes all AI output tools via the MCP protocol. Five of these tools (`get_pending_ai_output`, `get_pending_ai_output_metadata`, `fetch_ai_output_content`, `mark_ai_output_picked_up`, `reject_ai_output`) are only called by the Obsidian plugin — never by AI/LLM clients. The plugin already uses direct HTTP for note ingestion (`/ingest-note`), and these five tools should follow the same pattern.

The edge function uses Hono on Supabase Edge Functions (Deno). Because Supabase doesn't pass subpaths to Hono's router, direct routes are dispatched by checking `url.pathname` inside the wildcard handler (not separate Hono route registrations).

## Goals / Non-Goals

**Goals:**
- Move five plugin-only tools from MCP to direct HTTP POST endpoints
- Follow the existing `/ingest-note` routing pattern in `index.ts`
- Update the Obsidian plugin to use direct HTTP calls (modeled on `callIngestNote`)
- Keep `create_ai_output` and `create_tasks_with_output` as MCP tools (AI-facing)

**Non-Goals:**
- Changing the database schema, RPC functions, or indexes
- Changing the auth mechanism
- Creating a generic HTTP routing abstraction
- Adding versioning or backwards-compatible MCP stubs

## Decisions

### 1. Extract handler functions from MCP tool callbacks into standalone exported functions

The current MCP tool callbacks contain the database logic inline. We'll extract the core logic of each tool into an exported async function in `tools/ai_output.ts` that takes `supabase` and the relevant parameters, returning a typed result. Both the HTTP route handlers (new) and MCP tool registrations (for `create_ai_output` / `create_tasks_with_output`) will use these functions.

**Why:** Avoids duplicating database logic between MCP and HTTP handlers. The extracted functions are the single source of truth for each operation.

**Alternative considered:** Duplicating the logic in HTTP handlers — rejected because it violates DRY and makes bugs harder to fix.

### 2. All five endpoints use POST method

Even though `get_pending_ai_output` and `get_pending_ai_output_metadata` are read-only queries, we use POST for all endpoints. This is consistent with the existing `/ingest-note` pattern and avoids introducing GET-with-auth-header semantics.

**Why:** Consistency with the existing pattern. The `?key=` query param auth works naturally with POST. These aren't public REST APIs — they're internal plugin-to-backend calls.

### 3. Endpoint naming convention

Endpoints use kebab-case matching the tool names:
- `/get-pending-ai-output` (POST, no body)
- `/get-pending-ai-output-metadata` (POST, no body)
- `/fetch-ai-output-content` (POST, body: `{ ids: string[] }`)
- `/mark-ai-output-picked-up` (POST, body: `{ ids: string[] }`)
- `/reject-ai-output` (POST, body: `{ ids: string[] }`)

**Why:** Consistent with `/ingest-note` naming. Kebab-case is the convention already established.

### 4. HTTP response format

All endpoints return JSON with the shape `{ success: boolean, data?: T, error?: string }`:
- Success: `{ success: true, data: [...] }` or `{ success: true, message: "..." }`
- Error: `{ success: false, error: "..." }` with appropriate HTTP status

This matches the `/ingest-note` response format (which uses `success` + `message` or `error`).

**Why:** Consistent with existing endpoint. The `data` field is added for query endpoints that return arrays.

### 5. Plugin URL construction

The plugin will use a generalized version of `buildIngestNoteUrl` that accepts an endpoint name. A new `buildEndpointUrl(tbEndpointUrl, endpointName)` function replaces the specific `buildIngestNoteUrl`. The existing `callIngestNote` is updated to use `buildEndpointUrl(url, "ingest-note")`.

**Why:** Avoids duplicating URL-parsing logic for each endpoint. Single function handles the `?key=` query string extraction for all direct HTTP routes.

### 6. Plugin replaces `callMCP` with direct HTTP calls for these 5 operations

The plugin's `pollAIOutput`, `fetchAndDeliverOutputs`, and `rejectOutputs` methods will call a new generic `callHTTP(endpointName, body?)` method instead of `callMCP`. The `callMCP` method remains for any future MCP tool calls but is no longer used by AI output operations.

**Why:** Direct HTTP calls are simpler (plain JSON, no JSON-RPC envelope, no SSE parsing).

### Test Strategy

- **Unit tests:** Not applicable — there is no `terrestrial-core` dependency in this repo. The edge function runs on Deno/Supabase.
- **Integration tests:** The Obsidian plugin is tested manually by running it in Obsidian with the real endpoint.
- **Manual verification:** Deploy the edge function, then verify the plugin's poll/accept/reject cycle works end-to-end.

## Risks / Trade-offs

- **[Breaking MCP clients]** Any external tool calling these 5 MCP tools will break. → **Mitigation:** The tool descriptions already state these are internal plugin tools. No external consumers are known.
- **[Deployment ordering]** If the edge function is deployed before the plugin is updated, the plugin will fail on the next poll cycle (MCP tools no longer registered). → **Mitigation:** Deploy edge function and plugin update together. The plugin update is a local file change, so there's no deployment dependency.
- **[`callMCP` becomes unused]** After this change, `callMCP` has no callers. → **Decision:** Remove `callMCP` entirely since no MCP tools are called by the plugin.
