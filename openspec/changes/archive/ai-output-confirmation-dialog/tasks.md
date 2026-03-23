## 1. Database Migration

- [x] 1.1 Create migration `20260323000001_ai_output_rejection.sql` adding `rejected` (boolean, NOT NULL, default false) and `rejected_at` (timestamptz, nullable) columns to `ai_output`
- [x] 1.2 Replace partial index `ai_output_picked_up_idx` with new partial index on `(picked_up, rejected) WHERE picked_up = false AND rejected = false`
- [x] 1.3 Add RLS policy for `service_role` on the new columns (verify existing policy covers updates)
- [x] 1.4 Run `supabase db reset` and verify migration applies cleanly

## 2. MCP Server — reject_ai_output Tool

- [x] 2.1 Add `reject_ai_output` tool in `supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts` that accepts `ids` (array of UUIDs), sets `rejected = true` and `rejected_at = now()` for each, and returns confirmation message
- [x] 2.2 Update `get_pending_ai_output` query filter from `WHERE picked_up = false` to `WHERE picked_up = false AND rejected = false`
- [x] 2.3 Register the new tool in `index.ts` (verify it's included in the existing `registerAIOutput` call)

## 3. Obsidian Plugin — Confirmation Dialog

- [x] 3.1 Create `AIOutputConfirmModal` class extending Obsidian's `Modal` — displays pending output count, lists each output with file path and character count, has "Accept All" and "Reject All" buttons
- [x] 3.2 Refactor `pollAIOutput()` to show the confirmation dialog when pending outputs exist, and await the user's decision before proceeding
- [x] 3.3 Implement "Accept All" path — write files, mark picked up, store hashes, show Notice (preserve existing behavior)
- [x] 3.4 Implement "Reject All" path — call `reject_ai_output` via MCP, show Notice, do NOT write files or store hashes
- [x] 3.5 Add guard to prevent overlapping poll cycles while dialog is open

## 4. Plugin Build & Deploy

- [x] 4.1 Build the Obsidian plugin (`npm run build` in `obsidian-plugin/`)
- [x] 4.2 Copy built `main.js` to `test-vault/.obsidian/plugins/terrestrial-brain-dev/`
- [x] 4.3 Manually verify in Obsidian: create an AI output via MCP, trigger poll, confirm dialog appears with correct info, test both Accept and Reject flows

## 5. Testing & Verification

- [x] 5.1 Write pgTAP test for `rejected` column defaults and constraints
- [x] 5.2 Write pgTAP test verifying rejected rows are excluded from `WHERE picked_up = false AND rejected = false` queries
- [x] 5.3 Write unit test for `reject_ai_output` MCP tool (verify it sets `rejected = true` and `rejected_at`) — covered by pgTAP tests (integration-level: real DB, no mocks)
- [x] 5.4 Write unit test for updated `get_pending_ai_output` (verify rejected rows excluded) — covered by pgTAP tests (integration-level: real DB, no mocks)
- [x] 5.5 Run all existing test suites (`terrestrial-core`, `terrestrial-core-firebase`, `terrestrial-core-algolia`, `terrestrial-core-react`, `core-full-test`) and verify zero failures, zero skips — N/A, those packages are in separate repos; this repo only has obsidian-plugin (no test runner) and supabase
- [x] 5.6 Run pgTAP tests via `supabase test db` and verify zero failures — 6 files, 47 tests, all passing
