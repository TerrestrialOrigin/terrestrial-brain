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
| `tools/thoughts.ts` | search_thoughts, list_thoughts, thought_stats, capture_thought, ingest_note |
| `tools/projects.ts` | create_project, list_projects, get_project, update_project, archive_project |
| `tools/tasks.ts` | create_task, list_tasks, update_task, archive_task |
| `tools/ai_output.ts` | create_ai_output, get_pending_ai_output, mark_ai_output_picked_up |

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
  1. Creates a new `StreamableHTTPTransport`
  2. Connects the MCP server to the transport
  3. Delegates request handling to the transport
