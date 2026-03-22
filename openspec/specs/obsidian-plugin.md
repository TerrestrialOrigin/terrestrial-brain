# Obsidian Plugin

The Obsidian plugin (`terrestrial-brain-sync`) watches the vault for markdown file changes and syncs them to the Terrestrial Brain MCP endpoint. It also polls for AI-generated notes and writes them to the vault.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tbEndpointUrl` | `""` | Full MCP endpoint URL (including ?key= param) |
| `excludeTag` | `"terrestrialBrainExclude"` | Notes with this tag (inline or frontmatter) are never synced |
| `debounceMs` | `300000` (5 min) | Wait time after last edit before auto-syncing. Minimum: 60000 (1 min) |
| `pollIntervalMs` | `600000` (10 min) | Interval for checking for new AI notes. Minimum: 60000 (1 min) |
| `aiNotesFolderBase` | `"AI Notes"` | Default folder for AI-generated notes when no suggested_path is set |

## Persisted State

Settings and `syncedHashes` (Record<filePath, hash>) are saved together via `this.saveData()`. The hash cache survives Obsidian restarts and prevents duplicate syncs.

---

## Scenarios

### Auto-sync on edit

GIVEN the plugin is loaded and `tbEndpointUrl` is configured
WHEN a markdown file is modified in the vault
THEN the plugin starts (or resets) a per-file debounce timer for `debounceMs` milliseconds

GIVEN the debounce timer fires for a file
AND the file is not excluded
AND the file's content hash differs from the last synced hash
WHEN the timer callback runs
THEN the plugin:
  1. Reads the file content
  2. Strips YAML frontmatter
  3. Calls `ingest_note` via MCP with content, title (basename), and note_id (vault-relative path)
  4. Stores the new content hash in syncedHashes
  5. Persists syncedHashes to disk

GIVEN the file's content hash matches the last synced hash
WHEN the timer fires
THEN no sync occurs (duplicate prevention)

---

### Manual sync — current note

GIVEN the plugin is loaded
WHEN the user triggers "Sync current note to Terrestrial Brain" (command or ribbon icon)
THEN the plugin:
  1. Cancels any pending debounce timer for this file
  2. Calls `processNote` with force=true (bypasses hash check)
  3. Shows a Notice with the result

---

### Manual sync — entire vault

GIVEN the plugin is loaded
WHEN the user triggers "Sync entire vault to Terrestrial Brain"
THEN the plugin:
  1. Gets all markdown files in the vault
  2. Filters out excluded files
  3. For each eligible file (sequentially):
     a. Cancels any pending timer
     b. Calls `processNote` with force=true and silent=true
  4. Shows a progress Notice during sync
  5. Shows a final Notice with success/failure counts

---

### Exclusion check

GIVEN a file is being considered for sync
WHEN `isExcluded(file)` is called
THEN the plugin SHALL check, in order:
  1. Standalone frontmatter boolean: if `cache.frontmatter?.[excludeTag] === true`, return true
  2. Inline tags from Obsidian's metadata cache (e.g. `#terrestrialBrainExclude`)
  3. Frontmatter `tags` array (supports both array and single-value format)
  4. Comparison is case-insensitive, leading `#` is stripped
  5. Returns true if the excludeTag is found in any of the above checks

#### Scenario: Frontmatter boolean exclusion
- **WHEN** a file has `terrestrialBrainExclude: true` as a standalone frontmatter boolean (not in the `tags` array)
- **THEN** `isExcluded()` SHALL return `true`

#### Scenario: Frontmatter boolean with non-true value
- **WHEN** a file has `terrestrialBrainExclude: false` as a standalone frontmatter boolean
- **THEN** `isExcluded()` SHALL return `false` (unless the tag appears in inline or frontmatter tags)

#### Scenario: Tag-based exclusion still works
- **WHEN** a file has `terrestrialBrainExclude` in the frontmatter `tags` array or as an inline tag
- **THEN** `isExcluded()` SHALL return `true` (existing behavior preserved)

#### Scenario: No exclusion markers present
- **WHEN** a file has neither the frontmatter boolean nor the tag
- **THEN** `isExcluded()` SHALL return `false`

---

### AI notes polling

GIVEN the plugin is loaded and `tbEndpointUrl` is configured
WHEN the plugin starts
THEN it immediately polls for unsynced AI notes

GIVEN the poll interval elapses
WHEN the interval callback fires
THEN the plugin polls for unsynced AI notes

GIVEN unsynced AI notes are returned
WHEN the plugin polls
THEN for each note:
  1. Determines the file path: `suggested_path` or `{aiNotesFolderBase}/{title}.md`
  2. Creates parent folders if they don't exist
  3. Writes the file content (overwrites if exists — AI notes are authoritative)
  4. Computes the content hash using `simpleHash(stripFrontmatter(content).trim())` and stores it in `syncedHashes[filePath]`
  5. Collects the note ID
After all notes are written:
  6. Calls `mark_notes_synced` with the collected IDs
  7. Persists `syncedHashes` to disk via `saveSettings()`
  8. Shows a Notice: "{N} AI note(s) synced to vault"

#### Scenario: AI note write does not trigger re-ingestion
- **WHEN** an AI note is written to the vault by `pollAINotes()`
- **AND** the subsequent modify event fires and `processNote()` runs for that file
- **THEN** `processNote()` SHALL find a matching hash in `syncedHashes` and skip re-ingestion

#### Scenario: AI note hash uses same transformation as processNote
- **WHEN** `pollAINotes()` computes the hash for a written file
- **THEN** it SHALL use `simpleHash(stripFrontmatter(content).trim())` — identical to the hash computation in `processNote()`

#### Scenario: Hashes persisted after poll completes
- **WHEN** `pollAINotes()` finishes writing all files
- **THEN** it SHALL call `saveSettings()` once to persist all new hashes to disk

GIVEN no unsynced AI notes exist
WHEN the plugin polls
THEN nothing happens (silent)

---

### Manual AI notes poll

GIVEN the plugin is loaded
WHEN the user triggers "Pull AI notes from Terrestrial Brain"
THEN the plugin runs `pollAINotes()` immediately

---

### MCP communication

GIVEN the plugin needs to call an MCP tool
WHEN `callMCP(toolName, args)` is called
THEN the plugin:
  1. Sends a JSON-RPC 2.0 POST to `tbEndpointUrl`
  2. Handles two response formats:
     a. `application/json` — parses result directly
     b. `text/event-stream` — extracts data lines, parses each as JSON, returns first valid result
  3. Returns the text content from the first content block
  4. Throws on HTTP errors, JSON-RPC errors, or tool errors (isError)

---

### Plugin lifecycle

GIVEN Obsidian loads the plugin
WHEN `onload()` runs
THEN:
  1. Loads settings and syncedHashes from disk
  2. Registers file modify event handler
  3. Registers commands: sync current note, sync vault, poll AI notes
  4. Adds ribbon icon (brain icon)
  5. Adds settings tab
  6. Runs initial AI notes poll
  7. Starts poll interval timer

GIVEN Obsidian unloads the plugin
WHEN `onunload()` runs
THEN all pending debounce timers are cleared
