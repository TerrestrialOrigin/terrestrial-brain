# AI Notes

The reverse data path: AI-generated markdown content that gets synced back to the user's Obsidian vault.

## Data Model

- **Table:** `ai_notes`
- **Fields:** id (uuid), title (text), content (text — full markdown including frontmatter), suggested_path (text, nullable — e.g. "AI Notes/CarChief/analysis.md"), created_at_utc (bigint — UTC milliseconds), synced_at (bigint, nullable — null means not yet pulled by plugin)
- **Indexes:** btree on synced_at, btree on created_at_utc (desc)

---

## Scenarios

### create_ai_note

GIVEN the MCP server is running
WHEN a client calls `create_ai_note` with `title`, `content` (raw markdown without frontmatter), optional `suggested_path`
THEN the system:
  1. Generates a UUID (`tb_id`) and ISO timestamp
  2. Prepends YAML frontmatter to the content:
     - `tb_id`: random UUID
     - `created_utc`: UTC milliseconds
     - `created_readable`: ISO 8601 string
     - `terrestrialBrainExclude: true` (prevents re-ingestion by plugin)
  3. Inserts into `ai_notes` with synced_at=null
  4. Returns "Created AI note '{title}' (id: {uuid})\nWill sync to: {path}"
     - Path defaults to "AI Notes/{title}.md" if no suggested_path

---

### get_unsynced_ai_notes

GIVEN the MCP server is running
WHEN a client calls `get_unsynced_ai_notes` (no parameters)
THEN returns a JSON array of all ai_notes where synced_at IS NULL, ordered by created_at_utc ascending
  - Each entry includes: id, title, content, suggested_path, created_at_utc

---

### mark_notes_synced

GIVEN the MCP server is running
WHEN a client calls `mark_notes_synced` with `ids` (array of UUID strings)
THEN sets synced_at to the current UTC milliseconds for all matching rows
AND returns "Marked N note(s) as synced."
