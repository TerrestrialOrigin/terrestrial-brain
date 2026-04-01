## Context

Three thought MCP tools format timestamps using `toLocaleDateString()` which outputs date-only strings like "4/1/2026". The `updated_at` field is only shown by `get_thought_by_id` and is omitted from `list_thoughts` and `search_thoughts`. The `match_thoughts` Postgres RPC doesn't return `updated_at` at all.

## Goals / Non-Goals

**Goals:**
- Full ISO 8601 timestamps in all thought responses (e.g. `2026-04-01T18:10:38.666Z`)
- `updated_at` visible in all three tools when present
- `match_thoughts` RPC returns `updated_at`

**Non-Goals:**
- Custom date formatting or timezone configuration
- Changes to write paths (`capture_thought`)

## Decisions

### 1. Use `toISOString()` for timestamp formatting

ISO 8601 is unambiguous, machine-parseable, and includes full time precision. This is the simplest change — replace `.toLocaleDateString()` with `.toISOString()` at each formatting site.

**Alternative considered:** Custom format like `YYYY-MM-DD HH:mm UTC` — rejected because ISO 8601 is a standard that agents parse reliably.

### 2. Migration to add `updated_at` to `match_thoughts` RPC

The `match_thoughts` function must be replaced via `CREATE OR REPLACE FUNCTION` to add `updated_at` to the return table and select list. This follows the pattern of existing migrations (e.g. `20260401000002_match_thoughts_add_author_reliability_filters.sql`).

### 3. Conditional display of `updated_at`

Show `updated_at` only when the value is present, matching the existing `get_thought_by_id` pattern. This avoids clutter for thoughts that have never been edited.

### Test Strategy

- **Integration tests**: Verify that `list_thoughts`, `search_thoughts`, and `get_thought_by_id` responses contain ISO 8601 formatted timestamps (match pattern `\d{4}-\d{2}-\d{2}T`). Existing integration tests already call these tools — extend them to assert timestamp format.

## Risks / Trade-offs

- **[RPC replacement is a DDL change]** → Low risk: `CREATE OR REPLACE FUNCTION` is atomic and the only change is adding a column to the return set. Existing callers that don't use `updated_at` are unaffected.
