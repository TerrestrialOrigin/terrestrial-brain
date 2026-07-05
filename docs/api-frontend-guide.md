# API Guide for Front-End (Obsidian Plugin) Work

Contract between the `terrestrial-brain-mcp` edge function and its clients (the Obsidian
plugin and MCP agents). Back-end changes that affect clients are documented here so
front-end work can proceed in parallel.

## Base URL

```
https://<project-ref>.supabase.co/functions/v1/terrestrial-brain-mcp        (production)
http://localhost:54321/functions/v1/terrestrial-brain-mcp                   (local stack)
```

## Authentication (change: header-based-auth, 2026-07-04)

All routes — the MCP endpoint at the base URL and every direct HTTP route — require the
shared access key (`MCP_ACCESS_KEY`).

- **Primary (use this):** `x-brain-key: <MCP_ACCESS_KEY>` request header.
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

## MCP endpoint

`POST` to the base URL with a JSON-RPC 2.0 body (`Accept: application/json, text/event-stream`).
Responses may arrive as JSON or SSE (`event:`/`data:` lines). 31 tools — see README.
