## Why

Thought MCP responses (`list_thoughts`, `search_thoughts`, `get_thought_by_id`) currently format timestamps with `toLocaleDateString()`, which discards the time component (showing only e.g. "4/1/2026"). This makes it impossible for agents to distinguish between thoughts captured on the same day or to reason about intra-day recency. Additionally, `list_thoughts` and `search_thoughts` omit `updated_at` entirely, hiding edit history.

## Non-goals

- Changing the underlying database schema or column types
- Adding timezone selection or user-configurable date formatting
- Modifying `capture_thought` or `thought_stats` responses

## What Changes

- Replace `toLocaleDateString()` with `toISOString()` in all three thought response formatters
- Add `updated_at` to the `list_thoughts` select query and response format
- Add `updated_at` to the `match_thoughts` Postgres RPC return table so `search_thoughts` can display it
- Display `updated_at` conditionally (only when it differs from `created_at` or is present) in all three tools

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `thoughts` (`openspec/specs/thoughts.md`): Thought query responses change from date-only to full ISO 8601 timestamps, and `updated_at` is included in all three query tools

## Impact

- **Supabase edge function**: `tools/thoughts.ts` — formatting changes in `list_thoughts`, `search_thoughts`, `get_thought_by_id`
- **Postgres migration**: New migration to add `updated_at` column to `match_thoughts` RPC return table
- **No breaking changes**: Response shape is text, not structured — consumers parse display text
