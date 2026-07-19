# API Guide for Front-End (Obsidian Plugin) Work

Contract between the `terrestrial-brain-mcp` edge function and its clients (the Obsidian
plugin and MCP agents). Back-end changes that affect clients are documented here so
front-end work can proceed in parallel.

## Base URL

```
https://<project-ref>.supabase.co/functions/v1/terrestrial-brain-mcp        (production)
http://localhost:55421/functions/v1/terrestrial-brain-mcp                   (local stack)
```

## Authentication (change: header-based-auth, 2026-07-04)

All routes — the MCP endpoint at the base URL and every direct HTTP route — require the
shared access key (`MCP_ACCESS_KEY`).

- **Primary (use this):** `x-tb-key: <MCP_ACCESS_KEY>` request header.
- **Deprecated fallback:** `?key=<MCP_ACCESS_KEY>` query parameter. Kept only for MCP
  clients that cannot set custom headers. Do not use it in new client code — keys in
  URLs leak into logs and traces.
- **Precedence:** when both are present, the header is the value verified.
- **Failure:** missing or wrong key → HTTP 401 `{"error": "Invalid or missing access key"}`.
- Verification is constant-time server-side.

## Direct HTTP routes

All are `POST`, JSON in/out, and share the auth above. Success responses are
`{ "success": true, ... }`; failures are `{ "success": false, "error": "<message>" }`.

| Route | Body | Response |
|---|---|---|
| `/ingest-note` | `{ content, title?, note_id? }` | `{ success, message? }` |
| `/get-pending-ai-output` | — | `{ success, data: [...] }` |
| `/get-pending-ai-output-metadata` | — | `{ success, data: [...] }` |
| `/fetch-ai-output-content` | `{ ids: string[] }` | `{ success, data: [...] }` |
| `/mark-ai-output-picked-up` | `{ ids: string[] }` | `{ success, message }` |
| `/reject-ai-output` | `{ ids: string[] }` | `{ success, message }` |

Request bodies are schema-validated at the dispatcher (Step 18):

- Malformed JSON returns `400 { "success": false, "error": "Invalid JSON body" }` (previously a 500).
- `ids` must be 1–100 UUID strings; a missing/non-array value keeps the legacy
  `"ids array is required"` message, and non-UUID elements or an oversized array
  are rejected with 400 before any database call.
- Routes are matched only at exactly `<function-base>/<route>`; nested paths fall
  through to the MCP transport.
- `mark-ai-output-picked-up` / `reject-ai-output` messages count the rows
  **actually updated** — a retried (already-processed) pickup reports
  `"Marked 0 outputs as picked up."` rather than echoing the request size. Treat
  a 200 with a 0-count as "already done", not as an error.

## MCP endpoint

`POST` to the base URL with a JSON-RPC 2.0 body (`Accept: application/json, text/event-stream`).
Responses may arrive as JSON or SSE (`event:`/`data:` lines). 38 tools — see README.

### `list_open_tasks_by_project` (change: list-open-tasks-by-project)

Read-only. Returns every incomplete (status ≠ `done`), unarchived task across the whole
brain, grouped by project, in one call — the whole-brain "what's on my plate, by project"
view. For a single project's list or status/overdue filtering, use `list_tasks` instead.

- **Input:** `{ include_deferred?: boolean = true, limit?: integer = 500 (1–1000) }`.
  `include_deferred: false` drops `deferred` tasks (keeps `open` / `in_progress`).
- **Output:** a markdown text body — one `## <Project name> (<n>)` section per project
  (projects alphabetical), tasks whose `project_id` does not resolve under
  `## (Unknown project <id>)`, and unassigned tasks under `## (No project) (<n>)` rendered
  last. Header line: `<total> open task(s) across <G> group(s):`.
- **Empty state:** `No open tasks.` (a success, not an error).
- **Truncation:** results are bounded by `limit`; when more tasks exist the body ends with
  an explicit `⚠️ Showing the first <limit> tasks; more exist. …` notice (also logged).
- **Telemetry:** logs real `records_returned` (total emitted) and `returned_ids`.
