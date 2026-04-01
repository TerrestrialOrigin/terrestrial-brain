## 1. Database Migration

- [x] 1.1 Create migration file adding `reliability` (text, nullable) and `author` (text, nullable) columns to the `thoughts` table
- [x] 1.2 Add backfill in the same migration: `UPDATE thoughts SET reliability = 'less reliable', author = 'gpt-4o-mini' WHERE reliability IS NULL`

## 2. Extract ingest_note Handler

- [x] 2.1 Extract the `ingest_note` handler body from `server.registerTool(...)` in `tools/thoughts.ts` into a standalone async function `handleIngestNote(supabase, { content, title, note_id })` that returns `{ success: boolean, message?: string, error?: string }`
- [x] 2.2 Update `handleIngestNote` to set `reliability = 'less reliable'` and `author = 'gpt-4o-mini'` on all thought inserts and updates (both fresh ingest and reconciliation paths)
- [x] 2.3 Update `freshIngest()` in `helpers.ts` to accept and pass through `reliability` and `author` parameters to thought inserts

## 3. Server Routing

- [x] 3.1 Add `POST /ingest-note` Hono route in `index.ts` before the MCP wildcard handler, with the same `x-brain-key` auth check, calling `handleIngestNote`
- [x] 3.2 Add input validation on the route: return HTTP 400 if `content` is missing/empty
- [x] 3.3 Return plain JSON responses: `{ success: true, message }` on success, `{ success: false, error }` on failure, HTTP 500 on unexpected errors

## 4. De-register ingest_note from MCP

- [x] 4.1 Remove the `server.registerTool("ingest_note", ...)` call from `tools/thoughts.ts`
- [x] 4.2 Export `handleIngestNote` from `tools/thoughts.ts` so `index.ts` can import it for the Hono route

## 5. Obsidian Plugin Update

- [x] 5.1 Add `callIngestNote(content, title, noteId)` method to the plugin that constructs the `/ingest-note` URL from `tbEndpointUrl` (inserting `/ingest-note` before the query string), sends a plain JSON POST, and returns the message string
- [x] 5.2 Update `processNote()` to call `callIngestNote()` instead of `callMCP("ingest_note", ...)`
- [x] 5.3 Build the plugin (`npm run build` in `obsidian-plugin/`) and verify no build errors

## 6. Spec Updates

- [x] 6.1 Update `openspec/specs/thoughts.md` data model section to include `reliability` and `author` columns
- [x] 6.2 Update `openspec/specs/mcp-server.md` tool modules table to remove `ingest_note` and document the `/ingest-note` HTTP route
- [x] 6.3 Update `openspec/specs/obsidian-plugin/spec.md` auto-sync scenario to reference `/ingest-note` HTTP call instead of MCP
- [x] 6.4 Update `openspec/specs/enhanced-ingest.md` to include `reliability` and `author` in thought population requirements

## 7. Testing & Verification

- [x] 7.1 Write unit tests for `handleIngestNote`: verify `reliability` and `author` are set on inserts (fresh and reconciliation paths)
- [x] 7.2 Write integration test for the `/ingest-note` HTTP route: verify auth, request/response format, successful ingest
- [x] 7.3 Write integration test for MCP tool list: verify `ingest_note` is NOT present
- [x] 7.4 Run all existing test suites across all packages and fix any failures or skips
- [x] 7.5 Run E2E tests with Firebase emulators and verify 0 failures, 0 skips
- [x] 7.6 Verify `npm run build` succeeds for both the edge function and the Obsidian plugin
