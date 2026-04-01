# MCP Server

The Supabase edge function that exposes Terrestrial Brain tools via the Model Context Protocol.

## Infrastructure

- **Runtime:** Deno (Supabase Edge Functions)
- **Web framework:** Hono 4.9.2
- **MCP SDK:** @modelcontextprotocol/sdk 1.24.3
- **Transport:** StreamableHTTPTransport (@hono/mcp)
- **Database client:** @supabase/supabase-js 2.47.10
- **Validation:** Zod 4.1.13

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin DB access |
| `MCP_ACCESS_KEY` | Shared secret for authenticating MCP clients |
| `OPENROUTER_API_KEY` | API key for OpenRouter (embeddings + LLM) |

## Tool Modules

Tools are organized into modules, each exporting a `register(server, supabase)` function:

| Module | Tools |
|--------|-------|
| `tools/thoughts.ts` | search_thoughts, list_thoughts, thought_stats, capture_thought |
| `tools/projects.ts` | create_project, list_projects, get_project, update_project, archive_project |
| `tools/tasks.ts` | create_task, list_tasks, update_task, archive_task |
| `tools/ai_output.ts` | create_ai_output, create_tasks_with_output |

---

## Direct HTTP Routes

The server exposes direct HTTP routes alongside the MCP transport for operations that should not be available to AI callers via MCP.

| Route | Method | Description |
|-------|--------|-------------|
| `/ingest-note` | POST | Ingest a full note into thoughts (used by Obsidian plugin). Accepts `{ content, title?, note_id? }`. Returns `{ success, message? }` or `{ success: false, error }`. |
| `/get-pending-ai-output` | POST | Returns all pending AI outputs with full content. Returns `{ success, data: [...] }`. |
| `/get-pending-ai-output-metadata` | POST | Returns metadata (no content body) for pending AI outputs via RPC. Returns `{ success, data: [...] }`. |
| `/fetch-ai-output-content` | POST | Fetches full content for specified output IDs. Accepts `{ ids: string[] }`. Returns `{ success, data: [...] }`. |
| `/mark-ai-output-picked-up` | POST | Marks outputs as delivered. Accepts `{ ids: string[] }`. Returns `{ success, message }`. |
| `/reject-ai-output` | POST | Marks outputs as rejected. Accepts `{ ids: string[] }`. Returns `{ success, message }`. |

Direct routes use the same `x-brain-key` authentication as MCP requests. Because Supabase Edge Functions do not pass URL subpaths to Hono's router, direct routes are dispatched by checking `url.pathname` inside the wildcard handler rather than using separate Hono route registrations.

---

## Scenarios

### Authentication

GIVEN a request arrives at the MCP server
WHEN the `x-brain-key` header or `?key=` query param matches `MCP_ACCESS_KEY`
THEN the request is processed by the MCP transport

GIVEN the key is missing or does not match
WHEN a request arrives
THEN the server returns HTTP 401: `{"error": "Invalid or missing access key"}`

---

### CORS

GIVEN any request arrives
WHEN CORS middleware runs
THEN it allows:
  - Origin: `*`
  - Methods: POST, GET, OPTIONS
  - Headers: Content-Type, x-brain-key

---

### Request handling

GIVEN a valid authenticated request arrives
WHEN the handler runs
THEN:
  1. Checks if the URL path matches a direct HTTP route (`/ingest-note`, `/get-pending-ai-output`, `/get-pending-ai-output-metadata`, `/fetch-ai-output-content`, `/mark-ai-output-picked-up`, `/reject-ai-output`)
  2. If matched: dispatches to the corresponding handler function
  3. If not matched: creates a `StreamableHTTPTransport`, connects the MCP server, and delegates to the transport

#### Scenario: Direct HTTP route dispatched before MCP
- **WHEN** a POST request arrives with a path ending in `/mark-ai-output-picked-up`
- **THEN** the server SHALL handle it as a direct HTTP endpoint
- **AND** SHALL NOT pass the request to the MCP transport

#### Scenario: Unknown path falls through to MCP
- **WHEN** a POST request arrives with a path not matching any direct route
- **THEN** the server SHALL delegate to the MCP transport as before

---

### AI output HTTP route handlers

The edge function SHALL import handler functions from `tools/ai_output.ts` for the five AI output HTTP endpoints. Each handler receives the Supabase client and request parameters, performs the database operation, and returns a result. The route handler in `index.ts` wraps the result in the standard `{ success, data/message, error }` HTTP response format.

#### Scenario: Handler function reuse
- **WHEN** the `/get-pending-ai-output` HTTP route receives a request
- **THEN** it SHALL call the same handler function that was previously used by the MCP tool
- **AND** the database query SHALL be identical
