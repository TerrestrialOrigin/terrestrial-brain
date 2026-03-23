# Design: AI Output Lazy Fetch, Size Display, and Empty-Poll Notice

## Architecture

### Two-phase fetch

**Phase 1 — Metadata poll** (`get_pending_ai_output_metadata`):
```sql
SELECT id, title, file_path, octet_length(content) AS content_size, created_at
FROM ai_output
WHERE picked_up = false AND rejected = false
ORDER BY created_at ASC
```
Returns JSON array of `{ id, title, file_path, content_size, created_at }` — no `content` column.

**Phase 2 — Content fetch** (`fetch_ai_output_content`):
Called only after user clicks "Accept All". Takes array of IDs, returns array of `{ id, content }`.

```sql
SELECT id, content
FROM ai_output
WHERE id = ANY($ids) AND picked_up = false AND rejected = false
```

The existing `get_pending_ai_output` tool is kept for backward compatibility but the plugin stops using it.

### Size formatting

A `formatFileSize(bytes: number): string` utility function:
- < 1024 → `"N bytes"`
- < 1024² → `"N.N KB"`
- < 1024³ → `"N.N MB"`
- ≥ 1024³ → `"N.N GB"`

Uses 1 decimal place. This runs in the plugin, not the server — the server returns raw byte count.

### Empty-poll notice

`pollAIOutput()` gains an optional `manual: boolean` parameter. When `manual === true` and the metadata response is empty, show `new Notice("No pending AI output to pull")`. Automatic polls remain silent on empty.

## Decisions

### Why a new tool instead of modifying `get_pending_ai_output`?

Backward compatibility. Other clients (or future versions) may still expect the full content in one call. The old tool remains functional. The plugin switches to the new two-phase flow.

### Why `octet_length` instead of `char_length`?

`octet_length` gives the actual byte size of the UTF-8 encoded content, which is what the user cares about (disk space). Character count is misleading for multi-byte characters and doesn't map to storage.

### Why compute size server-side?

The whole point of lazy fetch is to not send content to the client. The server must compute and return the size.

### User error scenarios

- **User closes dialog without clicking a button**: treated as rejection (existing behavior, unchanged).
- **User accepts but network fails during content fetch**: error notice shown, outputs remain unpicked (can retry next poll).
- **MCP server returns content_size = 0**: valid edge case (empty file), displayed as "0 bytes".

### Security analysis

- **Malicious large output**: Now mitigated — content is not fetched until accepted. The metadata-only poll transfers O(n) where n = number of outputs × ~200 bytes per metadata record, regardless of content size.
- **Replay/tampering of IDs during fetch**: The `fetch_ai_output_content` query filters on `picked_up = false AND rejected = false`, so already-processed IDs return nothing.
- **TOCTOU between metadata poll and content fetch**: Possible that content changes between the two queries. Mitigated by the fact that AI output content is immutable once created (no UPDATE on content column exists).

### Test Strategy

- **Unit tests**: `formatFileSize` utility, dialog rendering with size display, manual vs automatic poll notice behavior
- **Integration tests**: `get_pending_ai_output_metadata` returns correct fields without content, `fetch_ai_output_content` returns content for valid IDs, returns empty for already-picked-up IDs
