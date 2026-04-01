## Context

`list_documents` currently supports only `project_id` and `limit` as filters. The tool queries `supabase.from("documents").select(...)` with an optional `.eq("project_id", project_id)`. As document volume grows, users need to find documents by title or content without knowing the project UUID. The implementation lives entirely in `supabase/functions/terrestrial-brain-mcp/tools/documents.ts`.

## Goals / Non-Goals

**Goals:**
- Enable case-insensitive title substring search via `title_contains` parameter
- Enable case-insensitive content substring search via `search` parameter
- Maintain AND-composability with existing `project_id` filter
- Keep the response shape unchanged (metadata only, no content body)

**Non-Goals:**
- Full-text search with `tsvector`/`tsquery` indexing — premature for current volume
- Returning content snippets or match highlights
- Adding database indexes for search — `ilike` on unindexed columns is acceptable at current scale
- Pagination beyond the existing `limit` parameter

## Decisions

### 1. Use Postgres `ilike` for both filters

**Choice**: Use Supabase client's `.ilike()` method with `%value%` pattern for both `title_contains` and `search`.

**Rationale**: The Supabase JS client natively supports `.ilike()` which maps to Postgres `ILIKE`. This is the simplest approach with zero migration overhead. At the current document volume (likely hundreds, not millions), sequential scan with `ilike` is fast enough.

**Alternative considered**: Postgres full-text search (`to_tsvector`/`plainto_tsquery`) — rejected because it requires a migration to create text search indexes and the current scale doesn't justify the complexity. Can be revisited later as a drop-in replacement.

### 2. Filter chaining via Supabase query builder

**Choice**: Chain `.ilike()` calls on the existing query builder, same pattern as the existing `.eq("project_id", ...)`.

```typescript
if (title_contains) query = query.ilike("title", `%${title_contains}%`);
if (search) query = query.ilike("content", `%${search}%`);
```

**Rationale**: This naturally produces AND logic when multiple filters are applied. Follows the exact same conditional-chaining pattern already used for `project_id`.

### 3. Input sanitization

**Choice**: Rely on Supabase client's parameterized queries for SQL injection prevention. Zod schema validates both new params as `z.string().optional()`.

**Rationale**: The Supabase JS client uses PostgREST which parameterizes all values — `ilike` values are never interpolated into raw SQL. The existing codebase uses the same approach for all other filters without additional sanitization.

### 4. No special characters escaping for `ilike` wildcards

**Choice**: Do not escape `%` or `_` characters in user input.

**Rationale**: This is an internal MCP tool used by AI, not a public-facing API. The AI calling this tool won't inject wildcard characters accidentally. If needed later, escaping can be added trivially.

### Test Strategy

- **Unit tests**: Not applicable — this is a thin query-builder change in an edge function with no extractable unit logic.
- **Integration tests**: Test `list_documents` MCP tool calls with various filter combinations against real Supabase (or emulator). Verify correct filtering, AND composition, and unchanged response shape.
- **E2E tests**: Not applicable — no browser UI involved. MCP tool integration tests serve as the E2E layer.

## Risks / Trade-offs

- **Performance at scale**: `ilike` on unindexed `content` column will degrade with large document volumes → Mitigation: acceptable at current scale; can add `GIN` trigram index or switch to `tsvector` later without API changes.
- **Content search on large documents**: `ilike` on large `content` values is slower than title search → Mitigation: the `limit` parameter caps result set size; Postgres stops scanning after finding enough matches.
