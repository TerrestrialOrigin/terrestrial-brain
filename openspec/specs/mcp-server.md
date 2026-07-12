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

Direct routes use the same `x-tb-key` authentication as MCP requests. Because Supabase Edge Functions do not pass URL subpaths to Hono's router, direct routes are dispatched by checking `url.pathname` inside the wildcard handler rather than using separate Hono route registrations.

---

## Scenarios

### Authentication

#### Requirement: Constant-time access-key verification

The server SHALL verify the provided access key against `MCP_ACCESS_KEY` using a constant-time comparison (SHA-256 digest of both values, compared with a branch-free byte fold). The comparison SHALL NOT short-circuit on the first differing character and SHALL NOT leak the expected key's length.

- **WHEN** a request arrives whose provided key exactly matches `MCP_ACCESS_KEY`
- **THEN** the request is processed normally

- **WHEN** a request arrives whose provided key differs from `MCP_ACCESS_KEY` (any difference — prefix match, wrong length, empty)
- **THEN** the server returns HTTP 401 `{"error": "Invalid or missing access key"}`

#### Requirement: Header-primary authentication with deprecated query-param fallback

The server SHALL read the access key from the `x-tb-key` request header as the primary and default mechanism. The `?key=` query-parameter fallback is **disabled by default** and rejected unless the operator sets `TB_ALLOW_KEY_IN_QUERY=1` (the exact string `1`); any other value, including unset, means disabled. When the fallback is enabled and the header is absent, the server SHALL fall back to the `?key=` query parameter. When both are present, the header takes precedence regardless of the flag. The query-param mechanism is deprecated (keys in URLs leak through proxy/CDN/edge logs; retained only for MCP clients that cannot set custom headers).

- **WHEN** a request carries `x-tb-key: <valid key>` (flag off, the default) → authenticated
- **WHEN** a request carries `?key=<valid key>` and no header, flag off → HTTP 401 (the query key is not consulted)
- **WHEN** a request carries `?key=<valid key>` and no header, `TB_ALLOW_KEY_IN_QUERY=1` → authenticated (the deprecated path)
- **WHEN** a request carries a valid `x-tb-key` header and an invalid `?key=` parameter → authenticated (the header value is the one compared), regardless of the flag
- **WHEN** a request carries an invalid `x-tb-key` header and a valid `?key=` parameter → HTTP 401 (the header, being present, is the value compared)
- **WHEN** a request carries neither a header nor (when permitted) a consulted `?key=` → HTTP 401 `{"error": "Invalid or missing access key"}`

---

### CORS

GIVEN any request arrives
WHEN CORS middleware runs
THEN it allows:
  - Origin: only origins in the `TB_ALLOWED_ORIGINS` allowlist are reflected in `Access-Control-Allow-Origin`; an unset/empty allowlist denies every cross-origin request. The wildcard `*` is never emitted. (CORS is a browser-side control only; the access-key check is the authoritative gate for all clients.)
  - Methods: POST, GET, OPTIONS
  - Headers: Content-Type, x-tb-key

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
