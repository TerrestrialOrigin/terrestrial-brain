## 1. Extract Handler Functions (Edge Function)

- [x] 1.1 Extract `handleGetPendingAIOutput(supabase)` from the `get_pending_ai_output` MCP tool callback in `tools/ai_output.ts` — returns `{ data, error? }`
- [x] 1.2 Extract `handleGetPendingAIOutputMetadata(supabase)` from the `get_pending_ai_output_metadata` MCP tool callback — returns `{ data, error? }`
- [x] 1.3 Extract `handleFetchAIOutputContent(supabase, ids)` from the `fetch_ai_output_content` MCP tool callback — returns `{ data, error? }`
- [x] 1.4 Extract `handleMarkAIOutputPickedUp(supabase, ids)` from the `mark_ai_output_picked_up` MCP tool callback — returns `{ message, error? }`
- [x] 1.5 Extract `handleRejectAIOutput(supabase, ids)` from the `reject_ai_output` MCP tool callback — returns `{ message, error? }`
- [x] 1.6 Export all five handler functions from `tools/ai_output.ts`

## 2. Add HTTP Route Handlers (Edge Function)

- [x] 2.1 Import the five handler functions in `index.ts`
- [x] 2.2 Add route for `/get-pending-ai-output` POST in the wildcard handler (following `/ingest-note` pattern)
- [x] 2.3 Add route for `/get-pending-ai-output-metadata` POST
- [x] 2.4 Add route for `/fetch-ai-output-content` POST — validate `ids` array in request body, return 400 if missing
- [x] 2.5 Add route for `/mark-ai-output-picked-up` POST — validate `ids` array in request body, return 400 if missing
- [x] 2.6 Add route for `/reject-ai-output` POST — validate `ids` array in request body, return 400 if missing

## 3. Remove MCP Tool Registrations (Edge Function)

- [x] 3.1 Remove `server.registerTool("get_pending_ai_output", ...)` from `tools/ai_output.ts`
- [x] 3.2 Remove `server.registerTool("get_pending_ai_output_metadata", ...)`
- [x] 3.3 Remove `server.registerTool("fetch_ai_output_content", ...)`
- [x] 3.4 Remove `server.registerTool("mark_ai_output_picked_up", ...)`
- [x] 3.5 Remove `server.registerTool("reject_ai_output", ...)`

## 4. Update Obsidian Plugin

- [x] 4.1 Replace `buildIngestNoteUrl` with generic `buildEndpointUrl(tbEndpointUrl, endpointName)` function
- [x] 4.2 Update `callIngestNote` to use `buildEndpointUrl(url, "ingest-note")`
- [x] 4.3 Add `callHTTP(endpointName, body?)` method that makes direct POST calls and returns parsed JSON response
- [x] 4.4 Update `pollAIOutput` to call `callHTTP("get-pending-ai-output-metadata")` instead of `callMCP`
- [x] 4.5 Update `fetchAndDeliverOutputs` to call `callHTTP("fetch-ai-output-content", { ids })` and `callHTTP("mark-ai-output-picked-up", { ids })`
- [x] 4.6 Update `rejectOutputs` to call `callHTTP("reject-ai-output", { ids })`
- [x] 4.7 Remove the `callMCP` method entirely

## 5. Update Specs

- [x] 5.1 Update `openspec/specs/mcp-server.md` tool module table — `ai_output.ts` now only exposes `create_ai_output` and `create_tasks_with_output`; add five new entries to the Direct HTTP Routes table
- [x] 5.2 Build the Obsidian plugin (`npm run build` in `obsidian-plugin/`) to verify no compile errors

## 6. Testing & Verification

- [x] 6.1 Deploy edge function to Supabase and verify all five HTTP endpoints respond correctly with valid auth
- [x] 6.2 Verify MCP tools `create_ai_output` and `create_tasks_with_output` still work via MCP
- [x] 6.3 Install updated Obsidian plugin and verify the full poll → accept → deliver cycle works
- [x] 6.4 Verify the reject flow works end-to-end
- [x] 6.5 Verify that `/ingest-note` still works (regression check after `buildEndpointUrl` refactor)
