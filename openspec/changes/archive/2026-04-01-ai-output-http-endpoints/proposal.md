## Why

The four AI output management tools (`get_pending_ai_output`, `get_pending_ai_output_metadata`, `mark_ai_output_picked_up`, `reject_ai_output`) are only consumed by the Obsidian plugin, not by AI/LLM callers. Exposing them as MCP tools adds unnecessary surface area for AI agents and forces the plugin to use the heavier MCP JSON-RPC protocol for simple REST-style operations. Moving them to direct HTTP endpoints (following the existing `/ingest-note` pattern) simplifies the MCP tool surface and gives the plugin direct, simpler HTTP access.

## What Changes

- **BREAKING**: Remove `get_pending_ai_output`, `get_pending_ai_output_metadata`, `mark_ai_output_picked_up`, and `reject_ai_output` from the MCP tool registry
- Add four new direct HTTP POST endpoints to the edge function: `/get-pending-ai-output`, `/get-pending-ai-output-metadata`, `/mark-ai-output-picked-up`, `/reject-ai-output`
- Extract handler logic from MCP tool implementations into standalone functions reusable by the HTTP endpoints
- Update the Obsidian plugin to call the new HTTP endpoints instead of `callMCP()` for these four operations
- `fetch_ai_output_content` also moves to HTTP since it is only used by the plugin (same rationale)
- `create_ai_output` and `create_tasks_with_output` remain as MCP tools (used by AI callers)

## Non-goals

- Changing the database schema or RPC functions — the underlying data layer stays the same
- Changing the auth mechanism — new endpoints use the same `x-brain-key` / `?key=` auth
- Migrating `create_ai_output` or `create_tasks_with_output` — these are AI-facing tools and belong in MCP
- Changing the response payloads — the HTTP endpoints return the same data, just wrapped in `{ success, data?, error? }` instead of MCP content blocks

## Capabilities

### New Capabilities

- `ai-output-http-api`: Direct HTTP endpoints for AI output management operations consumed by the Obsidian plugin (get pending, get metadata, fetch content, mark picked up, reject)

### Modified Capabilities

- `ai-output` (`openspec/specs/ai-output/spec.md`): Requirements for `get_pending_ai_output`, `get_pending_ai_output_metadata`, `fetch_ai_output_content`, `mark_ai_output_picked_up`, and `reject_ai_output` change from "MCP tool" to "HTTP endpoint". Core behavior unchanged.
- `obsidian-plugin` (`openspec/specs/obsidian-plugin/spec.md`): AI output polling and delivery now uses direct HTTP calls instead of MCP `callMCP()`. The "MCP communication" section no longer applies to these operations.
- `mcp-server` (`openspec/specs/mcp-server.md`): Tool module table updated — `ai_output.ts` module only exposes `create_ai_output`. Direct HTTP routes table gains five new entries.

## Impact

- **Edge function** (`supabase/functions/terrestrial-brain-mcp/`): `index.ts` gains five new route handlers; `tools/ai_output.ts` loses four MCP tool registrations but keeps the handler logic as exported functions
- **Obsidian plugin** (`obsidian-plugin/src/main.ts`): Four `callMCP()` call sites replaced with direct HTTP POST calls using the same URL-building pattern as `callIngestNote()`
- **MCP clients**: Any external MCP client using these four tools will break — this is acceptable as the Obsidian plugin is the only consumer
- **No database changes**: Supabase migrations, RPC functions, and indexes are untouched
