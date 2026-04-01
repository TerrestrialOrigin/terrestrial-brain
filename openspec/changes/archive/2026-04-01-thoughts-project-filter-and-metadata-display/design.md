## Context

The `thoughts.ts` file defines five MCP tools for the knowledge base. Three of them — `list_thoughts`, `search_thoughts`, and `thought_stats` — return thought data to callers. Currently:

- **`list_thoughts`** supports filtering by `type`, `topic`, `person`, and `days`, but not by project. The select clause only fetches `content, metadata, created_at` — it does not fetch `reliability` or `author`. The output format shows date, type, and topics only.
- **`search_thoughts`** returns results from the `match_thoughts` RPC. Output shows similarity, date, type, topics, people, and action items — but not `reliability`, `author`, or project references.
- **`thought_stats`** aggregates types, topics, and people — but has no project awareness at all (no project_id filter, no project breakdown in output).

The `reliability` and `author` columns were added in migration `20260331000001` and are already populated — `capture_thought` sets `reliability='reliable'` and `author` to the caller's model name, while `ingest_note` sets `reliability='less reliable'` and `author='gpt-4o-mini'`. But these columns are invisible in list/search results.

Project references live in `metadata.references.projects` (array of UUIDs). The `get_thought_by_id` tool already displays project references — but list/search do not.

## Goals / Non-Goals

**Goals:**
- Add `project_id` filter to `list_thoughts` so callers can scope browsing to a single project
- Add `project_id` filter to `thought_stats` so callers can see stats for a specific project
- Include `reliability` and `author` in `list_thoughts` and `search_thoughts` output
- Include project names (resolved from UUIDs) in `list_thoughts` and `search_thoughts` output
- Ensure projects are treated as first-class metadata alongside people and topics in all output formatting

**Non-Goals:**
- Adding project filtering to `search_thoughts` (semantic search is vector-based; post-filtering would change the semantics of `limit` and `threshold`)
- Changing capture/ingest flows — they already handle project references correctly
- Adding new database columns or migrations
- Modifying the `match_thoughts` RPC

## Decisions

### 1. Project name resolution strategy

**Decision:** Batch-fetch project names in a single query after the main thought query returns, using the collected UUIDs.

**Rationale:** Project references are stored as UUIDs in metadata JSONB. Displaying UUIDs to callers is unhelpful — they need names. Joining at the SQL level is complex with JSONB arrays, so we resolve post-query. A single `SELECT id, name FROM projects WHERE id IN (...)` is efficient and simple.

**Alternative considered:** Inline resolution per-thought — rejected because it would create N+1 queries. Embedding names in metadata at write-time was considered but rejected because project names can change and we'd have stale data.

### 2. Select clause changes for list_thoughts

**Decision:** Add `reliability` and `author` to the `select()` call: `"content, metadata, created_at, reliability, author"`.

**Rationale:** These are top-level columns, not JSONB fields. They must be explicitly selected. The GIN index on metadata is unaffected — this is a simple column addition to the select clause.

### 3. search_thoughts — accessing reliability and author from match_thoughts RPC

**Decision:** Modify the `match_thoughts` RPC to return `reliability` and `author` columns alongside the existing return fields.

**Rationale:** The `match_thoughts` RPC currently returns `id, content, metadata, similarity, created_at`. It does not return `reliability` or `author`. Since we can't add columns to RPC results without updating the function definition, we need to update the SQL function. This is a small, additive change to the function's return type and SELECT clause.

**Alternative considered:** Making a second query to fetch reliability/author by IDs from the search results — rejected as unnecessarily complex when the RPC can simply include the columns.

### 4. Project filtering implementation in list_thoughts

**Decision:** Use Supabase JSONB containment: `q.contains("metadata", { references: { projects: [project_id] } })`.

**Rationale:** This matches the existing pattern used for `topics` and `people` filtering, and leverages the GIN index on `metadata`.

### 5. thought_stats project filtering

**Decision:** Add an optional `project_id` parameter. When provided, filter the metadata fetch query using the same JSONB containment pattern and scope all aggregations to those results only.

**Rationale:** This lets callers ask "show me stats for project X" without requiring a separate tool. The count query also needs the filter applied.

### 6. Output format for reliability and author

**Decision:** Show reliability and author on a single line in the result format, e.g., `Reliability: reliable | Author: claude-sonnet-4-6`. Omit if both are null (for any legacy thoughts that weren't backfilled).

**Rationale:** These are provenance fields — useful for the caller to assess the thought's trustworthiness but not primary content. A combined line keeps output compact.

### Test Strategy

- **Unit tests**: Not applicable — the MCP tools are thin Supabase query wrappers. Testing them in isolation with mocked Supabase provides little value.
- **Integration tests**: Test each modified tool through the MCP server with a real Supabase instance (emulator). Verify:
  - `list_thoughts` with `project_id` filter returns only matching thoughts
  - `list_thoughts` output includes reliability and author
  - `search_thoughts` output includes reliability and author
  - `thought_stats` with `project_id` returns scoped statistics
  - Project names are resolved correctly in output
- **E2E tests**: Verify the full flow through the deployed function endpoint.

## Risks / Trade-offs

**[Risk] Project name resolution adds latency to list/search responses**
Mitigation: Single batch query with `IN` clause. For typical result sets (10-20 thoughts), this resolves at most ~10 project UUIDs — negligible query time.

**[Risk] match_thoughts RPC change requires a migration**
Mitigation: The change is purely additive — adding `reliability` and `author` to the SELECT and return type. No breaking changes to existing callers.

**[Risk] Thoughts with no `metadata.references.projects` field**
Mitigation: The JSONB containment query naturally excludes thoughts without the field. The output formatter checks for existence before rendering. No error paths.

**[Trade-off] Project names can become stale if projects are renamed**
Accepted: We resolve names at query time, so this is a non-issue — names are always current.

## Migration Plan

1. Deploy updated `match_thoughts` RPC (SQL migration to add reliability/author to return type)
2. Deploy updated edge function with all thoughts.ts changes
3. No rollback concerns — all changes are additive and backward-compatible

## Open Questions

_(none — scope is well-defined)_
