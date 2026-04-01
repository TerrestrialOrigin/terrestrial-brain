## 1. Core Implementation

- [x] 1.1 Add `get_tasks` tool registration in `supabase/functions/terrestrial-brain-mcp/tools/tasks.ts` — accepts `ids` (array of UUIDs), validates non-empty and max 50, queries tasks with `.in("id", ids)`, batch-resolves project names, person names, and parent task content, formats output matching `list_tasks` style, reports missing IDs

## 2. Spec Updates

- [x] 2.1 Update `openspec/specs/tasks.md` with the new `get_tasks` scenario

## 3. Testing & Verification

- [x] 3.1 Deploy to local Supabase and manually verify `get_tasks` via MCP tool call with valid IDs, mixed valid/invalid IDs, empty array, and oversized array
- [x] 3.2 Run existing test suite (`supabase/tests/tasks.test.sql`) to confirm no regressions
