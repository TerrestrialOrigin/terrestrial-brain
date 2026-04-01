## MODIFIED Requirements

### Requirement: Tool Modules

Tools are organized into modules, each exporting a `register(server, supabase)` function:

| Module | Tools |
|--------|-------|
| `tools/thoughts.ts` | search_thoughts, list_thoughts, thought_stats, capture_thought |
| `tools/projects.ts` | create_project, list_projects, get_project, update_project, archive_project |
| `tools/tasks.ts` | create_task, list_tasks, update_task, archive_task |
| `tools/ai_output.ts` | create_ai_output, get_pending_ai_output, mark_ai_output_picked_up |

Note: `ingest_note` is no longer registered as an MCP tool. It is exposed as a direct HTTP route instead.

#### Scenario: MCP tool list does not include ingest_note
- **WHEN** a client sends a `tools/list` request to the MCP server
- **THEN** the response SHALL NOT include `ingest_note` in the tool list

### Requirement: Request handling

GIVEN a valid authenticated request arrives at the MCP server
WHEN the handler runs
THEN:
  1. The wildcard handler checks `url.pathname` to dispatch: if it ends with `/ingest-note` and the method is POST, the ingest handler processes it directly
  2. Otherwise, creates a new `StreamableHTTPTransport`, connects the MCP server, and delegates to the transport

Note: Supabase Edge Functions do not pass URL subpaths to Hono's router — all requests arrive at path `/`. Separate Hono route registrations (e.g. `app.post("/ingest-note")`) will never match. Dispatch MUST be done by inspecting the raw request URL inside the wildcard handler.

#### Scenario: Direct route takes precedence over MCP transport
- **WHEN** a POST request arrives with URL path ending in `/ingest-note` and valid auth
- **THEN** the wildcard handler SHALL process it via the ingest handler without MCP transport involvement

#### Scenario: Ingest route does not trigger MCP 406 error
- **WHEN** a POST request arrives at `/ingest-note` without `Accept: text/event-stream` header
- **THEN** the server SHALL NOT return 406 or a JSON-RPC "Not Acceptable" error
- **AND** SHALL return a plain JSON response from the ingest handler

#### Scenario: MCP requests still work
- **WHEN** a JSON-RPC request arrives at the base path with valid auth
- **THEN** the MCP transport SHALL handle the request as before

## ADDED Requirements

### Requirement: Direct HTTP route for ingest_note

The MCP server Hono app SHALL expose a `POST /ingest-note` route that accepts a plain JSON body and returns a plain JSON response. This route uses the same `x-brain-key` authentication as MCP requests.

#### Scenario: Successful ingest via HTTP route
- **WHEN** a POST request is sent to `/ingest-note` with headers `Content-Type: application/json` and valid `x-brain-key`, and body `{ "content": "...", "title": "...", "note_id": "..." }`
- **THEN** the server SHALL process the note (split, embed, store) and return HTTP 200 with body `{ "success": true, "message": "Synced ..." }`

#### Scenario: Ingest with missing content
- **WHEN** a POST request is sent to `/ingest-note` with an empty or missing `content` field
- **THEN** the server SHALL return HTTP 400 with body `{ "success": false, "error": "content is required" }`

#### Scenario: Ingest with invalid auth
- **WHEN** a POST request is sent to `/ingest-note` without a valid `x-brain-key` header or `?key=` param
- **THEN** the server SHALL return HTTP 401 with body `{ "error": "Invalid or missing access key" }`

#### Scenario: Ingest with optional fields omitted
- **WHEN** a POST request is sent to `/ingest-note` with only `content` (no `title` or `note_id`)
- **THEN** the server SHALL process the note with `title = undefined` and `note_id = undefined`, skipping snapshot upsert and reconciliation

#### Scenario: Internal error during ingest
- **WHEN** the ingest processing throws an unexpected error
- **THEN** the server SHALL return HTTP 500 with body `{ "success": false, "error": "..." }`
