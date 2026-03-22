## 1. MCP Tools — AI Output

- [x] 1.1 Create `supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts` with `register(server, supabase)` exporting three tools: `create_ai_output`, `get_pending_ai_output`, `mark_ai_output_picked_up`
- [x] 1.2 Update `index.ts` to import `tools/ai_output.ts` instead of `tools/ai_notes.ts`
- [x] 1.3 Delete `supabase/functions/terrestrial-brain-mcp/tools/ai_notes.ts`

## 2. Database Migration

- [x] 2.1 Create SQL migration to migrate unsynced `ai_notes` rows to `ai_output` and drop `ai_notes` table

## 3. Obsidian Plugin Updates

- [x] 3.1 Replace `AINote` interface with `AIOutput` interface (id, title, content, file_path, created_at)
- [x] 3.2 Update `TBPluginSettings`: remove `aiNotesFolderBase`, add `projectsFolderBase` (default: `"projects"`)
- [x] 3.3 Replace `pollAINotes()` with `pollAIOutput()` — call `get_pending_ai_output`, write files to `file_path`, hash content, call `mark_ai_output_picked_up`
- [x] 3.4 Update command registration: rename "Pull AI notes" to "Pull AI output", update command ID
- [x] 3.5 Update settings tab: remove AI notes folder setting, add projects folder base setting, rename poll interval label
- [x] 3.6 Update `onload()`: replace `pollAINotes()` calls with `pollAIOutput()`

## 4. Testing & Verification

- [x] 4.1 Create `tests/integration/ai_output.test.ts` — test `create_ai_output`, `get_pending_ai_output`, `mark_ai_output_picked_up` end-to-end
- [x] 4.2 Delete `tests/integration/ai_notes.test.ts`
- [x] 4.3 Update plugin tests (`obsidian-plugin/src/main.test.ts`) for `pollAIOutput()` and new settings
- [x] 4.4 Remove `supabase/tests/ai_notes.test.sql` pgTAP tests (ai_output pgTAP tests already exist from Sprint 1)
- [x] 4.5 Run full integration test suite and verify 0 failures, 0 skips
- [x] 4.6 Run plugin unit tests and verify 0 failures, 0 skips
- [x] 4.7 Run pgTAP tests (`supabase test db`) and verify 0 failures, 0 skips
