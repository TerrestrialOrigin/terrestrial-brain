## Why

The `thoughts` table lacks provenance fields — there's no way to tell whether a thought was reliably authored by a smart AI or lossy-extracted by the cheap pipeline, and no record of which model produced it. Meanwhile, `ingest_note` is registered as an MCP tool, which means any AI caller can invoke it — but it's a lossy pipeline designed for Obsidian note ingestion, not direct AI use. AI callers should use `capture_thought` instead. De-registering `ingest_note` from MCP removes this footgun while the Obsidian plugin continues to function by calling it as a direct HTTP endpoint.

## What Changes

- **Add `reliability` column** to `thoughts` table — text, nullable. Values: `'reliable'` (verbatim AI-authored) or `'less reliable'` (cheap-AI-extracted). Backfill all existing rows as `'less reliable'`.
- **Add `author` column** to `thoughts` table — text, nullable. Stores model identifier (e.g. `'gpt-4o-mini'`). Backfill all existing rows as `'gpt-4o-mini'`.
- **BREAKING: De-register `ingest_note` from MCP** — remove `server.registerTool(...)` call. AI callers can no longer invoke it via MCP.
- **Expose `ingest_note` as a direct HTTP route** on the MCP server Hono app (e.g. `POST /ingest-note`), authenticated with the same `x-brain-key` mechanism. The existing implementation logic is reused — only the entry point changes.
- **Update Obsidian plugin** to call `/ingest-note` as a regular HTTP POST instead of JSON-RPC `tools/call`. The plugin will send `{ content, title, note_id }` as a plain JSON body and receive a plain JSON response.
- **Set `reliability` and `author` on ingest_note path** — hardcode `reliability = 'less reliable'` and `author = 'gpt-4o-mini'` (or current extraction model constant) on all thoughts inserted/updated by `ingest_note`.

## Non-goals

- **Not changing `capture_thought` here.** The companion task (ID `5fc514a5`) will add `author` param and set `reliability = 'reliable'` on `capture_thought`. This change only sets the `'less reliable'` path on `ingest_note` and prepares the columns.
- **Not removing the ingest_note function logic.** The code stays; only the MCP registration is removed and a direct HTTP route is added.
- **Not changing any other MCP tools.** Only `ingest_note` is affected.

## Capabilities

### New Capabilities

_(none — no new spec-level capabilities are introduced)_

### Modified Capabilities

- `thoughts` (`openspec/specs/thoughts.md`): Data model gains `reliability` and `author` columns. `ingest_note` scenarios need to reflect that it is no longer an MCP tool, and that inserted thoughts carry `reliability = 'less reliable'` and `author = 'gpt-4o-mini'`.
- `mcp-server` (`openspec/specs/mcp-server.md`): Tool module table must remove `ingest_note` from `tools/thoughts.ts`. A new direct HTTP route `/ingest-note` must be documented.
- `obsidian-plugin` (`openspec/specs/obsidian-plugin/spec.md`): Auto-sync and manual sync scenarios must call `/ingest-note` via direct HTTP POST instead of MCP `tools/call`. A new `callIngestNote(content, title, noteId)` method replaces the `callMCP("ingest_note", ...)` call path.
- `enhanced-ingest` (`openspec/specs/enhanced-ingest.md`): Ingest scenarios must specify that thoughts carry `reliability` and `author` values.

## Impact

- **Database:** New migration adding two columns + backfill. Non-breaking (nullable columns with backfill).
- **MCP server (`supabase/functions/terrestrial-brain-mcp/`):** `tools/thoughts.ts` loses `ingest_note` registration. `index.ts` gains a new Hono route. Helper logic is refactored into a shared function callable from both the route and internally.
- **Obsidian plugin (`obsidian-plugin/src/main.ts`):** `processNote()` call path changes from `callMCP("ingest_note", ...)` to a direct HTTP POST to `/ingest-note`. The `callMCP` method itself is unchanged (other tools still use it).
- **Existing AI callers:** Any AI that was calling `ingest_note` via MCP will get a "tool not found" error. This is intentional — they should use `capture_thought`.
