# Obsidian Plugin

The Obsidian plugin (`terrestrial-brain-sync`) watches the vault for markdown file changes and syncs them to the Terrestrial Brain MCP endpoint. It also polls for AI-generated output and writes it to the vault.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tbEndpointUrl` | `""` | Full MCP endpoint URL (including ?key= param) |
| `excludeTag` | `"terrestrialBrainExclude"` | Notes with this tag (inline or frontmatter) are never synced |
| `syncDelayMinutes` | `5` | Wait time after last edit before auto-syncing, in minutes. Minimum: 1 minute |
| `pollIntervalMinutes` | `10` | Interval for checking for new AI output, in minutes. Minimum: 1 minute |
| `projectsFolderBase` | `"projects"` | Base folder for project files in the vault |

The plugin SHALL convert minute values to milliseconds internally (`value * 60000`) when scheduling timers.

## Persisted State

Settings and `syncedHashes` (Record<filePath, hash>) are saved together via `this.saveData()`. The hash cache survives Obsidian restarts and prevents duplicate syncs.

---

## Scenarios

### Auto-sync on edit

GIVEN the plugin is loaded and `tbEndpointUrl` is configured
WHEN a markdown file is modified in the vault
THEN the plugin starts (or resets) a per-file debounce timer using the sync delay converted to milliseconds (`syncDelayMinutes * 60000`)

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

#### Scenario: Timer uses minutes-to-ms conversion
- **WHEN** the plugin schedules a sync timer
- **THEN** the timer delay SHALL be `syncDelayMinutes * 60000` milliseconds

#### Scenario: Settings stored in minutes
- **WHEN** a user sets "Sync delay" to `3` in the settings UI
- **THEN** the plugin SHALL store `syncDelayMinutes: 3` in persisted data
- **AND** use `180000` milliseconds when scheduling the per-file debounce timer

#### Scenario: Poll interval stored in minutes
- **WHEN** a user sets "AI output poll interval" to `15` in the settings UI
- **THEN** the plugin SHALL store `pollIntervalMinutes: 15` in persisted data
- **AND** use `900000` milliseconds when scheduling the poll interval timer

#### Scenario: Minimum value enforcement
- **WHEN** a user enters a value less than 1 for sync delay or poll interval
- **THEN** the plugin SHALL NOT update the setting (ignore the invalid input)

#### Scenario: Migration from millisecond settings
- **WHEN** the plugin loads and finds `debounceMs` or `pollIntervalMs` in persisted data (from a previous version)
- **THEN** the plugin SHALL convert those values to minutes (divide by 60000, round to nearest integer)
- **AND** store the converted values as `syncDelayMinutes` and `pollIntervalMinutes`

---

### Manual sync — current note

GIVEN the plugin is loaded
WHEN the user triggers "Sync current note to Terrestrial Brain" (command or ribbon context menu)
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

### AI output polling

The plugin SHALL poll for pending AI output on startup and at each poll interval.

GIVEN the plugin is loaded and `tbEndpointUrl` is configured
WHEN the plugin starts
THEN it SHALL immediately poll for pending AI output

GIVEN the poll interval elapses
WHEN the interval callback fires
THEN the plugin SHALL poll for pending AI output

GIVEN pending AI output is returned
WHEN the plugin polls
THEN the plugin SHALL:
  1. Display a confirmation dialog (modal) listing all pending outputs with file path and character count
  2. Wait for the user to click "Accept All" or "Reject All"

GIVEN the user clicks "Accept All"
THEN the plugin SHALL for each output:
  1. Creates parent folders if they don't exist
  2. Writes the file content (overwrites if exists — AI output is authoritative)
  3. Computes the content hash using `simpleHash(stripFrontmatter(content).trim())` and stores it in `syncedHashes[filePath]`
  4. Collects the output ID
After all outputs are written:
  5. Calls `mark_ai_output_picked_up` with the collected IDs
  6. Persists `syncedHashes` to disk via `saveSettings()`
  7. Shows a Notice: "{N} AI output(s) delivered to vault"

GIVEN the user clicks "Reject All"
THEN the plugin SHALL handle rejection:
  1. Call `reject_ai_output` via MCP with all pending output IDs
  2. Show a Notice: "{N} AI output(s) rejected"
  3. NOT write any files to the vault

GIVEN no pending AI output exists
WHEN the plugin polls
THEN the plugin SHALL take no action (silent)

#### Scenario: AI output write does not trigger re-ingestion
- **WHEN** an AI output file is written to the vault by `pollAIOutput()` after user acceptance
- **AND** the subsequent modify event fires and `processNote()` runs for that file
- **THEN** `processNote()` SHALL find a matching hash in `syncedHashes` and skip re-ingestion

#### Scenario: AI output hash uses same transformation as processNote
- **WHEN** `pollAIOutput()` computes the hash for a written file
- **THEN** it SHALL use `simpleHash(stripFrontmatter(content).trim())` — identical to the hash computation in `processNote()`

#### Scenario: Hashes persisted after poll completes
- **WHEN** `pollAIOutput()` finishes writing all files after user acceptance
- **THEN** it SHALL call `saveSettings()` once to persist all new hashes to disk

#### Scenario: AI output content participates in normal ingest
- **WHEN** an AI output file is written to the vault
- **AND** the user later edits the file (changing the hash)
- **THEN** the modified file SHALL be processed by `processNote()` normally — no exclusion tag prevents ingest

#### Scenario: Rejection does not write files
- **WHEN** the user rejects pending AI output via the confirmation dialog
- **THEN** no files SHALL be written to the vault
- **AND** no hashes SHALL be added to `syncedHashes`

#### Scenario: Rejected outputs do not reappear
- **WHEN** the user rejects pending AI output
- **AND** the next poll cycle runs
- **THEN** the rejected outputs SHALL NOT appear in the pending list

---

### Manual AI output poll

GIVEN the plugin is loaded
WHEN the user triggers "Pull AI output from Terrestrial Brain"
THEN the plugin SHALL run `pollAIOutput()` immediately

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
  3. Registers commands: sync current note, sync vault, poll AI output
  4. Adds ribbon icon (brain icon) with context menu
  5. Adds settings tab
  6. Runs initial AI output poll
  7. Starts poll interval timer

GIVEN Obsidian unloads the plugin
WHEN `onunload()` runs
THEN all pending debounce timers are cleared

#### Scenario: Ribbon icon shows context menu
- **WHEN** the user clicks the brain ribbon icon
- **THEN** the plugin SHALL display a context menu with exactly two items:
  1. "Sync note to Terrestrial Brain"
  2. "Pull AI Output from Terrestrial Brain"

#### Scenario: Context menu sync action
- **WHEN** the user selects "Sync note to Terrestrial Brain" from the context menu
- **THEN** the plugin SHALL cancel any pending debounce timer for the active file
- **AND** call `processNote` with `force: true` for the active file
- **AND** show a Notice if no file is active

#### Scenario: Context menu pull action
- **WHEN** the user selects "Pull AI Output from Terrestrial Brain" from the context menu
- **THEN** the plugin SHALL run `pollAIOutput()` immediately
