# Tasks: AI Output Lazy Fetch, Size Display, and Empty-Poll Notice

## MCP Server Changes
- [x] Register `get_pending_ai_output_metadata` tool — returns id, title, file_path, content_size, created_at (no content body)
- [x] Register `fetch_ai_output_content` tool — accepts array of IDs, returns array of { id, content } for pending outputs only

## Obsidian Plugin Changes
- [x] Add `formatFileSize(bytes: number): string` exported utility function
- [x] Add `AIOutputMetadata` interface (id, title, file_path, content_size, created_at — no content)
- [x] Update `pollAIOutput()` to accept optional `manual` parameter; use `get_pending_ai_output_metadata` for phase 1
- [x] Show "No pending AI output to pull" notice when manual poll returns empty
- [x] On accept: call `fetch_ai_output_content` to get content, then deliver
- [x] On reject: call `reject_ai_output` (no content fetch needed)
- [x] Update `AIOutputConfirmModal` to accept `AIOutputMetadata[]` and display `formatFileSize(content_size)` instead of character count
- [x] Update all callers of `pollAIOutput()` (manual command, ribbon menu, startup, interval) to pass `manual` flag correctly

## Testing & Verification
- [x] Write unit tests for `formatFileSize`
- [x] Write unit tests for two-phase fetch flow (metadata → accept → content fetch → deliver)
- [x] Write unit tests for reject flow (metadata → reject → no content fetch)
- [x] Write unit tests for empty-poll notice (manual vs automatic)
- [x] Write integration tests for `get_pending_ai_output_metadata`
- [x] Write integration tests for `fetch_ai_output_content`
- [x] Run all existing plugin unit tests — 0 failures, 0 skips
- [x] Run all existing integration tests — 0 failures, 0 skips
