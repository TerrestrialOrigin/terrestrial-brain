# Obsidian Plugin

The Obsidian plugin (`terrestrial-brain-sync`) watches the vault for markdown file changes and syncs them to the Terrestrial Brain MCP endpoint. It also polls for AI-generated output and writes it to the vault.

## Purpose

The Obsidian plugin (`terrestrial-brain-sync`) watches the vault for markdown file changes and syncs them to the Terrestrial Brain MCP endpoint, and polls for AI-generated output to write back into the vault.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tbEndpointUrl` | `""` | MCP endpoint URL, stored without a `?key=` parameter (legacy key-in-URL values are auto-migrated) |
| `accessKey` | `""` | MCP access key; sent as an `x-brain-key` request header, never in the URL |
| `excludeTag` | `"terrestrialBrainExclude"` | Notes with this tag (inline or frontmatter) are never synced |
| `syncDelayMinutes` | `5` | Wait time after last edit before auto-syncing, in minutes. Minimum: 1 minute |
| `pollIntervalMinutes` | `10` | Interval for checking for new AI output, in minutes. Minimum: 1 minute |
| `projectsFolderBase` | `"projects"` | Base folder for project files in the vault |

The plugin SHALL convert minute values to milliseconds internally (`value * 60000`) when scheduling timers.

## Persisted State

Settings and `syncedHashes` (Record<filePath, hash>) are saved together via `this.saveData()`. The hash cache survives Obsidian restarts and prevents duplicate syncs.

---

## Requirements

### Requirement: Auto-sync on edit

The plugin SHALL start (or reset) a per-file debounce timer when a markdown file is modified, and on timer fire SHALL sync the file to the `/ingest-note` endpoint only when the file is not excluded and its content hash differs from the last synced hash.

#### Scenario: Modify starts debounce timer
- **WHEN** the plugin is loaded, `tbEndpointUrl` is configured, and a markdown file is modified in the vault
- **THEN** the plugin SHALL start (or reset) a per-file debounce timer using the sync delay converted to milliseconds (`syncDelayMinutes * 60000`)

#### Scenario: Timer fire syncs changed file
- **WHEN** the debounce timer fires for a file
- **AND** the file is not excluded
- **AND** the file's content hash differs from the last synced hash
- **THEN** the plugin SHALL read the file content
- **AND** strip YAML frontmatter
- **AND** call the `/ingest-note` HTTP endpoint directly with `{ content, title (basename), note_id (vault-relative path) }` as a plain JSON POST
- **AND** store the new content hash in `syncedHashes`
- **AND** persist `syncedHashes` to disk

#### Scenario: Matching hash skips sync
- **WHEN** the file's content hash matches the last synced hash
- **AND** the timer fires
- **THEN** no sync SHALL occur (duplicate prevention)

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

### Requirement: Manual sync — current note

The plugin SHALL sync the current note on demand when the user triggers "Sync current note to Terrestrial Brain", bypassing the hash check.

#### Scenario: User syncs current note
- **WHEN** the plugin is loaded and the user triggers "Sync current note to Terrestrial Brain" (command or ribbon context menu)
- **THEN** the plugin SHALL cancel any pending debounce timer for this file
- **AND** call `processNote` with force=true (bypasses hash check)
- **AND** show a Notice with the result

---

### Requirement: Manual sync — entire vault

The plugin SHALL sync every eligible markdown file in the vault on demand when the user triggers "Sync entire vault to Terrestrial Brain".

#### Scenario: User syncs entire vault
- **WHEN** the plugin is loaded and the user triggers "Sync entire vault to Terrestrial Brain"
- **THEN** the plugin SHALL get all markdown files in the vault
- **AND** filter out excluded files
- **AND** for each eligible file (sequentially) cancel any pending timer and call `processNote` with force=true and silent=true
- **AND** show a progress Notice during sync
- **AND** show a final Notice with success/failure counts

---

### Requirement: Exclusion check

The plugin SHALL determine whether a file is excluded from sync via `isExcluded(file)`, checking the standalone frontmatter boolean, inline tags, and the frontmatter `tags` array, with case-insensitive comparison and a stripped leading `#`.

#### Scenario: isExcluded evaluation order
- **WHEN** `isExcluded(file)` is called for a file being considered for sync
- **THEN** the plugin SHALL check, in order: (1) standalone frontmatter boolean — if `cache.frontmatter?.[excludeTag] === true`, return true; (2) inline tags from Obsidian's metadata cache (e.g. `#terrestrialBrainExclude`); (3) frontmatter `tags` array (supports both array and single-value format)
- **AND** comparison SHALL be case-insensitive with the leading `#` stripped
- **AND** the plugin SHALL return true if the excludeTag is found in any of the above checks

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

### Requirement: Copy path generation for conflicting AI output

The plugin SHALL provide a `generateCopyPath` function that computes an alternative file path when the original target already exists in the vault. The function takes a vault-relative file path and returns a path with a numeric suffix appended before the file extension.

#### Scenario: Basic copy name generation
- **WHEN** the original path is `projects/Plan.md` and that file exists in the vault
- **AND** `projects/Plan(2).md` does NOT exist
- **THEN** `generateCopyPath` SHALL return `projects/Plan(2).md`

#### Scenario: Incremented copy name when (2) already exists
- **WHEN** the original path is `projects/Plan.md` and that file exists
- **AND** `projects/Plan(2).md` also exists
- **AND** `projects/Plan(3).md` does NOT exist
- **THEN** `generateCopyPath` SHALL return `projects/Plan(3).md`

#### Scenario: Multiple increments
- **WHEN** the original path is `notes/Todo.md`
- **AND** `notes/Todo(2).md`, `notes/Todo(3).md`, and `notes/Todo(4).md` all exist
- **AND** `notes/Todo(5).md` does NOT exist
- **THEN** `generateCopyPath` SHALL return `notes/Todo(5).md`

#### Scenario: Root-level file (no parent directory)
- **WHEN** the original path is `README.md` and that file exists
- **AND** `README(2).md` does NOT exist
- **THEN** `generateCopyPath` SHALL return `README(2).md`

#### Scenario: Safety cap at 100 attempts
- **WHEN** the original path exists and copies `(2)` through `(101)` all exist
- **THEN** `generateCopyPath` SHALL throw an error indicating the copy limit was exhausted

#### Scenario: Copy name preserves directory
- **WHEN** the original path is `deeply/nested/folder/doc.md`
- **THEN** `generateCopyPath` SHALL return a path in the same directory (`deeply/nested/folder/doc(N).md`)
- **AND** SHALL NOT change the directory portion of the path

---

### Requirement: AI output polling

The plugin SHALL poll for pending AI output on startup and at each poll interval, and on returned output SHALL run conflict detection, present an accept/reject confirmation dialog, and deliver or reject the outputs accordingly.

#### Scenario: Poll on startup
- **WHEN** the plugin is loaded, `tbEndpointUrl` is configured, and the plugin starts
- **THEN** it SHALL immediately poll for pending AI output

#### Scenario: Poll on interval
- **WHEN** the poll interval elapses and the interval callback fires
- **THEN** the plugin SHALL poll for pending AI output

#### Scenario: Pending output presented for confirmation
- **WHEN** the plugin polls and pending AI output is returned
- **THEN** the plugin SHALL check which pending outputs target existing vault files (conflict detection)
- **AND** display a confirmation dialog (modal) listing all pending outputs with file path, character count, and conflict status
- **AND** wait for the user to click "Accept All" or "Reject All"

#### Scenario: Accept All delivers outputs
- **WHEN** the user clicks "Accept All"
- **THEN** the plugin SHALL, for each output: create parent folders if they don't exist; if the user chose "Save as copy" for this output, compute the copy path via `generateCopyPath` and write to the copy path instead, otherwise write the file content to the original path (overwrites if exists); compute the content hash using `simpleHash(stripFrontmatter(content).trim())` and store it in `syncedHashes[actualWrittenPath]`; and collect the output ID
- **AND** after all outputs are written, call the `/mark-ai-output-picked-up` HTTP endpoint with the collected IDs
- **AND** persist `syncedHashes` to disk via `saveSettings()`
- **AND** show a Notice: "{N} AI output(s) delivered to vault"

#### Scenario: Reject All discards outputs
- **WHEN** the user clicks "Reject All"
- **THEN** the plugin SHALL call the `/reject-ai-output` HTTP endpoint with all pending output IDs
- **AND** show a Notice: "{N} AI output(s) rejected"
- **AND** NOT write any files to the vault

#### Scenario: No pending output is silent
- **WHEN** the plugin polls and no pending AI output exists
- **THEN** the plugin SHALL take no action (silent)

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

#### Scenario: Renamed file hash stored under actual path
- **WHEN** a user chose "Save as copy" for a conflicting AI output
- **AND** the file is written to `path/File(2).md` instead of `path/File.md`
- **THEN** `syncedHashes` SHALL contain an entry for `path/File(2).md`
- **AND** SHALL NOT contain a new entry for `path/File.md` from this delivery

#### Scenario: Copy path generation failure skips file
- **WHEN** `generateCopyPath` throws (e.g., exhausted 100 attempts)
- **THEN** that specific file SHALL be skipped
- **AND** a Notice SHALL be shown for the error
- **AND** remaining files SHALL still be delivered

#### Scenario: Conflict detection runs before dialog
- **WHEN** `pollAIOutput()` retrieves pending AI output metadata
- **THEN** the plugin SHALL call `this.app.vault.adapter.exists(path)` for each output's `file_path` before constructing the confirmation dialog

---

### Requirement: Manual AI output poll

The plugin SHALL run `pollAIOutput()` immediately when the user triggers "Pull AI output from Terrestrial Brain".

#### Scenario: User pulls AI output
- **WHEN** the plugin is loaded and the user triggers "Pull AI output from Terrestrial Brain"
- **THEN** the plugin SHALL run `pollAIOutput()` immediately

---

### Requirement: MCP communication

The plugin SHALL call direct HTTP endpoints on the edge function via `callHTTP(endpointName, body?)`, and the `callMCP` method SHALL be removed since no operations use MCP JSON-RPC from the plugin.

#### Scenario: callHTTP request flow
- **WHEN** the plugin needs to call a direct HTTP endpoint on the edge function and `callHTTP(endpointName, body?)` is called
- **THEN** the plugin SHALL construct the URL using `buildEndpointUrl(tbEndpointUrl, endpointName)`
- **AND** send a POST request with `Content-Type: application/json` header, plus `x-brain-key: <accessKey>` when `accessKey` is non-empty
- **AND** if `body` is provided, serialize it as JSON in the request body
- **AND** parse the JSON response
- **AND** if `response.success` is false, throw an error with `response.error`
- **AND** otherwise return the parsed response object

#### Scenario: Successful HTTP call with data
- **WHEN** `callHTTP("get-pending-ai-output-metadata")` is called
- **AND** the endpoint returns `{ success: true, data: [...] }`
- **THEN** `callHTTP` SHALL return the full response object

#### Scenario: Successful HTTP call with message
- **WHEN** `callHTTP("mark-ai-output-picked-up", { ids: [...] })` is called
- **AND** the endpoint returns `{ success: true, message: "..." }`
- **THEN** `callHTTP` SHALL return the full response object

#### Scenario: HTTP error response
- **WHEN** `callHTTP` receives a non-2xx HTTP status
- **THEN** it SHALL throw an error with the response body

#### Scenario: Endpoint returns success: false
- **WHEN** `callHTTP` receives `{ success: false, error: "..." }`
- **THEN** it SHALL throw an error with the error message

---

### Requirement: Generic endpoint URL construction

The plugin SHALL provide a `buildEndpointUrl(tbEndpointUrl, endpointName)` function that constructs a direct HTTP endpoint URL from the base MCP endpoint URL. The function inserts `/<endpointName>` before the query string. This replaces the specific `buildIngestNoteUrl` function.

#### Scenario: URL with query string
- **WHEN** `buildEndpointUrl("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc", "mark-ai-output-picked-up")` is called
- **THEN** it SHALL return `"https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp/mark-ai-output-picked-up?key=abc"`

#### Scenario: URL without query string
- **WHEN** `buildEndpointUrl("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp", "ingest-note")` is called
- **THEN** it SHALL return `"https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp/ingest-note"`

#### Scenario: Backwards compatibility with ingest-note
- **WHEN** `callIngestNote` calls `buildEndpointUrl(url, "ingest-note")`
- **THEN** it SHALL produce the same URL as the old `buildIngestNoteUrl` function

---

### Requirement: Dedicated access-key setting sent as request header

The plugin SHALL store the access key in a dedicated `accessKey` setting (default `""`), separate from the endpoint URL. Every HTTP request the plugin makes to the brain (`callHTTP`, `callIngestNote`) SHALL send the key in an `x-brain-key` request header when `accessKey` is non-empty, and SHALL NOT append the key to the request URL.

#### Scenario: Header sent on generic HTTP calls
- **WHEN** `callHTTP` runs with `accessKey` set to `"secret123"`
- **THEN** the outgoing request includes the header `x-brain-key: secret123`
- **AND** the request URL contains no `key` query parameter

#### Scenario: Header sent on note ingestion
- **WHEN** `callIngestNote` runs with `accessKey` set
- **THEN** the outgoing request includes the `x-brain-key` header with that value

#### Scenario: Empty key omits the header
- **WHEN** `accessKey` is `""`
- **THEN** no `x-brain-key` header is added (the server responds 401 and the existing error path surfaces it)

### Requirement: Legacy key-in-URL settings migration

On settings load, and on endpoint-URL entry in the settings tab, the plugin SHALL detect a `key` query parameter in the stored/entered endpoint URL, move its value into the `accessKey` setting when `accessKey` is empty, and strip the `key` parameter from the URL (removing the `?` entirely when no other parameters remain). When `accessKey` is already non-empty, the URL is still stripped but the existing `accessKey` value is kept.

#### Scenario: Migration on load
- **WHEN** settings load with `tbEndpointUrl = "https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc"` and empty `accessKey`
- **THEN** after load, `accessKey` is `"abc"` and `tbEndpointUrl` is `"https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp"`

#### Scenario: Existing accessKey wins
- **WHEN** settings load with a `?key=urlkey` URL and `accessKey` already `"fieldkey"`
- **THEN** `accessKey` remains `"fieldkey"` and the URL is stripped of the `key` parameter

#### Scenario: Other query parameters preserved
- **WHEN** the stored URL is `"https://host/fn?foo=1&key=abc"`
- **THEN** after migration the URL is `"https://host/fn?foo=1"` and `accessKey` is `"abc"`

#### Scenario: Paste into settings tab migrates immediately
- **WHEN** the user enters a URL containing `?key=abc` in the endpoint-URL setting
- **THEN** the key is moved to the access-key setting (if empty) and the persisted URL contains no `key` parameter

### Requirement: Non-HTTPS endpoint warning

The settings tab SHALL display a persistent warning beneath the endpoint-URL setting whenever the configured endpoint uses plain `http://` and the host is not `localhost` or `127.0.0.1`. The plugin SHALL still allow such endpoints (no hard block). An exported helper `isInsecureEndpoint(url)` SHALL implement the check.

#### Scenario: Plain HTTP production endpoint warns
- **WHEN** the endpoint URL is `"http://example.com/functions/v1/terrestrial-brain-mcp"`
- **THEN** `isInsecureEndpoint` returns true and the settings tab shows the cleartext warning

#### Scenario: Localhost HTTP endpoint does not warn
- **WHEN** the endpoint URL is `"http://localhost:54321/functions/v1/terrestrial-brain-mcp"` or the `127.0.0.1` equivalent
- **THEN** `isInsecureEndpoint` returns false and no warning is shown

#### Scenario: HTTPS endpoint does not warn
- **WHEN** the endpoint URL starts with `https://`
- **THEN** `isInsecureEndpoint` returns false and no warning is shown

---

### Requirement: Plugin lifecycle

On load the plugin SHALL initialize settings, event handlers, commands, UI, and timers, and on unload SHALL clear all pending debounce timers.

#### Scenario: onload initialization
- **WHEN** Obsidian loads the plugin and `onload()` runs
- **THEN** the plugin SHALL load settings and `syncedHashes` from disk
- **AND** register the file modify event handler
- **AND** register commands: sync current note, sync vault, poll AI output
- **AND** add the ribbon icon (brain icon) with context menu
- **AND** add the settings tab
- **AND** run the initial AI output poll
- **AND** start the poll interval timer

#### Scenario: onunload clears timers
- **WHEN** Obsidian unloads the plugin and `onunload()` runs
- **THEN** all pending debounce timers SHALL be cleared

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
