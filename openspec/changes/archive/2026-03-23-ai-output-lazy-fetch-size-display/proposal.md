# AI Output: Lazy Fetch, Size Display, and Empty-Poll Notice

## Motivation

Three usability and security improvements to the AI output delivery flow:

1. **Size display**: The confirmation dialog currently shows character counts (e.g. "2,340 chars") which are meaningless to most users. Show human-readable file sizes (bytes, KB, MB) instead.

2. **Lazy fetch (security)**: Currently `get_pending_ai_output` returns the full content body. This means malicious or excessively large output is already on the user's machine *before* they decide to accept or reject. The confirmation dialog exists to protect users — but if content is already downloaded, it's too late (memory is consumed). The server should return only metadata (file_path + content_size) during the poll, and the plugin should fetch full content only after the user clicks "Accept All".

3. **Empty-poll notice**: When the user *manually* triggers "Pull AI Output" and there is nothing pending, nothing happens — no feedback at all. The user can't tell if the operation succeeded with zero results or if something is broken. Show an informative notice in this case.

## Scope

- MCP server: new `get_pending_ai_output_metadata` tool (returns id, title, file_path, content_size — no content body); new `fetch_ai_output_content` tool (returns full content for given IDs)
- Obsidian plugin: update `pollAIOutput()` to use two-phase fetch; update dialog to show formatted file size; add `manual` flag for empty-poll notice
- Database: no schema changes needed (content_size is computed at query time via `octet_length`)

## Out of scope

- Per-item accept/reject (future enhancement)
- Content preview/truncation in the dialog
- Download progress indicators
