# Test Plan: Postpone AI Output Decision

## Unit Tests (Plugin — Vitest)

### Existing tests to update

1. **"does NOT call fetch_ai_output_content when user rejects"** — Update mock to return `"rejected"` instead of `false`
2. **"calls get_pending_ai_output_metadata, fetch_ai_output_content, and mark_ai_output_picked_up"** — Update mock to return `"accepted"` instead of `true`

### New tests

3. **"does NOT call fetch_ai_output_content or reject_ai_output when user postpones"**
   - GIVEN: pending AI outputs exist
   - WHEN: `showConfirmationDialog` returns `"postponed"`
   - THEN: only `get_pending_ai_output_metadata` is called; neither `fetch_ai_output_content` nor `reject_ai_output` is called

4. **"does not show any notice when user postpones"**
   - GIVEN: pending AI outputs exist
   - WHEN: `showConfirmationDialog` returns `"postponed"`
   - THEN: no Notice is displayed

## Layers not needed

- **Integration tests:** No backend changes; the postpone path makes zero MCP calls
- **E2E tests:** No new user-facing pages/routes; the modal is tested via unit tests with mocked Obsidian API
- **Database tests:** No schema changes
