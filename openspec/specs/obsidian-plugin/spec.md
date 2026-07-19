# Obsidian Plugin

The Obsidian plugin (`terrestrial-brain-sync`) watches the vault for markdown file changes and syncs them to the Terrestrial Brain MCP endpoint. It also polls for AI-generated output and writes it to the vault.

## Purpose

The Obsidian plugin (`terrestrial-brain-sync`) watches the vault for markdown file changes and syncs them to the Terrestrial Brain MCP endpoint, and polls for AI-generated output to write back into the vault.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tbEndpointUrl` | `""` | MCP endpoint URL, stored without a `?key=` parameter (legacy key-in-URL values are auto-migrated) |
| `accessKey` | `""` | MCP access key; sent as an `x-tb-key` request header, never in the URL |
| `excludeTag` | `"terrestrialBrainExclude"` | Notes with this tag (inline or frontmatter) are never synced |
| `syncDelayMinutes` | `5` | Wait time after last edit before auto-syncing, in minutes. Minimum: 1 minute |
| `pollIntervalMinutes` | `10` | Interval for checking for new AI output, in minutes. Minimum: 1 minute |

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

The plugin SHALL sync every eligible markdown file in the vault on demand when the user triggers "Sync entire vault to Terrestrial Brain". `processNote` SHALL return a `SyncOutcome` of `"synced"`, `"skipped"`, or `"failed"`, and the vault-sync command SHALL count failures from that return value (not from a thrown error). The final Notice SHALL reflect the real outcome — a failure Notice when any note failed, never a success Notice when notes failed.

#### Scenario: User syncs entire vault
- **WHEN** the plugin is loaded and the user triggers "Sync entire vault to Terrestrial Brain"
- **THEN** the plugin SHALL get all markdown files in the vault
- **AND** filter out excluded files
- **AND** for each eligible file (sequentially) cancel any pending timer and call `processNote` with force=true and silent=true
- **AND** show a progress Notice during sync
- **AND** count each file's outcome from the value `processNote` returns (`"synced"` / `"skipped"` / `"failed"`)
- **AND** show a final Notice with the real success/failure counts

#### Scenario: Total failure reports failure, not success
- **WHEN** the user syncs the entire vault and every note's ingestion fails (e.g. the endpoint is unreachable)
- **THEN** every `processNote` call SHALL return `"failed"`
- **AND** the final Notice SHALL report the failures (e.g. "0 ok, N failed")
- **AND** the plugin SHALL NOT show "Vault sync complete"

#### Scenario: Mixed outcome counts are accurate
- **WHEN** the user syncs the entire vault and some notes succeed while others fail
- **THEN** the final Notice SHALL report counts that match the actual per-note outcomes

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

The plugin SHALL run `pollAIOutput()` immediately when the user triggers "Pull AI output from Terrestrial Brain", and when a manual poll fails it SHALL surface the failure in a Notice (not only `console.error`).

#### Scenario: User pulls AI output
- **WHEN** the plugin is loaded and the user triggers "Pull AI output from Terrestrial Brain"
- **THEN** the plugin SHALL run `pollAIOutput()` immediately

#### Scenario: Manual pull failure is surfaced
- **WHEN** a manual `pollAIOutput({ manual: true })` fails (e.g. `callHTTP` throws)
- **THEN** the plugin SHALL show a Notice describing the failure
- **AND** SHALL also log the full error to `console.error`

#### Scenario: Automatic poll failure stays quiet
- **WHEN** an automatic (non-manual) `pollAIOutput()` fails
- **THEN** the plugin SHALL log the error to `console.error`
- **AND** SHALL NOT show a Notice (background polling stays silent)

---

### Requirement: MCP communication

The plugin SHALL communicate with the MCP endpoint through a `TerrestrialBrainApiClient` abstraction. The default `HttpTerrestrialBrainClient` implementation SHALL POST JSON to `{endpointUrl}/{endpointName}` (query string preserved), send the access key as an `x-tb-key` request header (never in the URL), parse the JSON response, throw an error carrying a bounded/sanitized `response.error` when `response.success` is false, and otherwise return the parsed response object. Note ingestion SHALL reuse the same request path (`ingestNote` is a thin wrapper over the shared call), eliminating a duplicated HTTP implementation.

#### Scenario: Successful HTTP call returns response object
- **WHEN** the client POSTs to an endpoint and the server responds `{ success: true, ... }`
- **THEN** the client SHALL return the full parsed response object

#### Scenario: Endpoint called with body
- **WHEN** the client is called with a body payload
- **THEN** it SHALL send the body as a JSON POST and return the full response object

#### Scenario: HTTP error response
- **WHEN** the server responds with a non-2xx status
- **THEN** the client SHALL throw an error containing the (bounded, sanitized) response body

#### Scenario: Failure response throws
- **WHEN** the server responds `{ success: false, error }`
- **THEN** the client SHALL throw an error carrying the sanitized `error` text

#### Scenario: Note ingestion shares the client request path
- **WHEN** the plugin ingests a note
- **THEN** it SHALL call the client's `ingestNote(content, title, noteId)`
- **AND** that call SHALL go through the same shared request/header/error handling as other endpoint calls (no separate duplicated HTTP code)

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

The plugin SHALL store the access key in a dedicated `accessKey` setting (default `""`), separate from the endpoint URL. Every HTTP request the plugin makes to the brain (`callHTTP`, `callIngestNote`) SHALL send the key in an `x-tb-key` request header when `accessKey` is non-empty, and SHALL NOT append the key to the request URL.

#### Scenario: Header sent on generic HTTP calls
- **WHEN** `callHTTP` runs with `accessKey` set to `"secret123"`
- **THEN** the outgoing request includes the header `x-tb-key: secret123`
- **AND** the request URL contains no `key` query parameter

#### Scenario: Header sent on note ingestion
- **WHEN** `callIngestNote` runs with `accessKey` set
- **THEN** the outgoing request includes the `x-tb-key` header with that value

#### Scenario: Empty key omits the header
- **WHEN** `accessKey` is `""`
- **THEN** no `x-tb-key` header is added (the server responds 401 and the existing error path surfaces it)

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

The settings tab SHALL display a persistent warning beneath the endpoint-URL setting whenever the configured endpoint uses plain `http://` and the host is not `localhost` or `127.0.0.1`. An exported helper `isInsecureEndpoint(url)` SHALL implement the check. In addition to the warning, the API client SHALL refuse to send any request to such an endpoint: before calling `fetch`, it SHALL throw an error explaining that the access key will not be sent over unencrypted `http://` and naming the remedy (use `https://` or a localhost test server). Localhost/`127.0.0.1` endpoints SHALL remain fully usable.

#### Scenario: Plain HTTP production endpoint warns
- **WHEN** the endpoint URL is `"http://example.com/functions/v1/terrestrial-brain-mcp"`
- **THEN** `isInsecureEndpoint` returns true and the settings tab shows the cleartext warning

#### Scenario: Localhost HTTP endpoint does not warn
- **WHEN** the endpoint URL is `"http://localhost:54321/functions/v1/terrestrial-brain-mcp"` or the `127.0.0.1` equivalent
- **THEN** `isInsecureEndpoint` returns false and no warning is shown

#### Scenario: HTTPS endpoint does not warn
- **WHEN** the endpoint URL starts with `https://`
- **THEN** `isInsecureEndpoint` returns false and no warning is shown

#### Scenario: Request to a non-local http endpoint is refused before send
- **WHEN** any client request (sync, vault sync, poll, forget) targets `"http://example.com/mcp"` 
- **THEN** the client SHALL throw the refusal error
- **AND** `fetch` SHALL never be invoked

#### Scenario: Localhost http endpoint still works
- **WHEN** a client request targets `"http://localhost:54321/functions/v1/terrestrial-brain-mcp"`
- **THEN** the request SHALL proceed normally

### Requirement: Plugin lifecycle

On load the plugin SHALL initialize settings, event handlers, commands, UI, and timers, and on unload SHALL clear all pending debounce timers and the poll interval.

#### Scenario: onload initialization
- **WHEN** Obsidian loads the plugin and `onload()` runs
- **THEN** the plugin SHALL load settings and `syncedHashes` from disk
- **AND** register the file modify event handler
- **AND** register the file delete event handler
- **AND** register the file rename event handler
- **AND** register commands: sync current note, sync vault, poll AI output
- **AND** add the ribbon icon (brain icon) with context menu
- **AND** add the settings tab
- **AND** run the initial AI output poll
- **AND** start the poll interval timer

#### Scenario: onunload clears timers
- **WHEN** Obsidian unloads the plugin and `onunload()` runs
- **THEN** all pending debounce timers SHALL be cleared
- **AND** the poll interval SHALL be cleared

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

---

### Requirement: processNote reports its outcome

`processNote(file, opts)` SHALL return a `SyncOutcome` value of `"synced"`, `"skipped"`, or `"failed"` describing what happened, instead of swallowing errors silently. Callers SHALL use this value to aggregate results.

#### Scenario: Successful ingest returns synced
- **WHEN** `processNote` reads a non-excluded, changed note and `callIngestNote` succeeds
- **THEN** it SHALL store the new hash, persist it, and return `"synced"`

#### Scenario: Excluded or no-op returns skipped
- **WHEN** the file is excluded, no endpoint is configured, the stripped content is empty, or (without force) the hash is unchanged
- **THEN** `processNote` SHALL return `"skipped"` without calling the ingest endpoint

#### Scenario: Ingest failure returns failed
- **WHEN** `callIngestNote` throws during `processNote`
- **THEN** `processNote` SHALL log the full error to `console.error`
- **AND** show a Notice when not silent
- **AND** return `"failed"`

---

### Requirement: Poll interval application is separate from persistence

Persisting settings SHALL NOT restart the AI-output poll interval. The plugin SHALL provide a persistence primitive that only writes data to disk, and SHALL (re)start the poll interval only when `pollIntervalMinutes` actually changes from the currently-applied value. This prevents the poll timer from being starved by frequent saves and prevents stale interval registrations from accumulating.

#### Scenario: Saving settings does not restart the interval
- **WHEN** the plugin persists settings after a sync, an AI-output delivery, or a non-interval settings-field edit
- **THEN** the poll interval SHALL NOT be torn down and rebuilt

#### Scenario: Changing the poll interval restarts the timer once
- **WHEN** the user changes `pollIntervalMinutes` to a new value
- **THEN** the plugin SHALL clear the existing poll interval and register exactly one new interval using the new value
- **AND** update the tracked applied interval value

#### Scenario: Re-applying the same interval is a no-op
- **WHEN** `applyPollInterval()` is invoked with a `pollIntervalMinutes` equal to the currently-applied value
- **THEN** the plugin SHALL NOT clear or re-register the interval

---

### Requirement: Crash-safe debounce and scheduled-sync retry

The per-file debounce timer callback SHALL NOT be able to raise an unhandled rejection, even if the file is deleted or unreadable when the timer fires. A scheduled (non-manual) sync that fails SHALL be retried with capped exponential backoff up to a bounded number of attempts; manual syncs SHALL NOT auto-retry.

#### Scenario: Timer body errors are contained
- **WHEN** a debounce timer fires and its body throws (e.g. `vault.read` rejects because the file was deleted during the delay)
- **THEN** the error SHALL be caught and logged
- **AND** no unhandled promise rejection SHALL occur

#### Scenario: Failed scheduled sync retries with backoff
- **WHEN** a scheduled sync fails (`processNote` returns `"failed"`) and the attempt count is below the maximum
- **THEN** the plugin SHALL re-schedule the sync for that file with a longer delay than the previous attempt (capped at a maximum delay)
- **AND** increment the attempt count

#### Scenario: Retry attempts are bounded
- **WHEN** a scheduled sync has failed the maximum number of attempts
- **THEN** the plugin SHALL stop retrying that file
- **AND** the file SHALL re-sync on the next real edit (its hash is unchanged)

#### Scenario: Manual sync does not auto-retry
- **WHEN** a manual (forced) sync fails
- **THEN** the plugin SHALL show the failure Notice
- **AND** SHALL NOT schedule an automatic retry

---

### Requirement: Vault delete and rename lifecycle

The plugin SHALL handle vault `delete` and `rename` events so stale timers and stale hashes do not persist.

#### Scenario: Deleting a file cancels its timer and drops its hash
- **WHEN** a markdown file with a pending debounce timer and/or a stored hash is deleted from the vault
- **THEN** the plugin SHALL cancel that file's pending timer
- **AND** remove the file's entry from `syncedHashes`
- **AND** persist the updated hashes

#### Scenario: Renaming a file re-keys its hash and cancels the old timer
- **WHEN** a markdown file is renamed (old path → new path)
- **THEN** the plugin SHALL cancel any pending timer registered under the old path
- **AND** move the `syncedHashes` entry from the old path to the new path when one exists
- **AND** persist the updated hashes

---

### Requirement: Error notices are bounded and sanitized

Server response bodies embedded in error messages shown to the user SHALL be truncated to a bounded length with whitespace collapsed, so a large or malformed body (e.g. an HTML error page or stack trace) is not shown verbatim in a Notice. Full, untruncated detail SHALL still be written to `console.error`.

#### Scenario: Oversized HTTP error body is truncated in the thrown message
- **WHEN** `callHTTP` receives a non-2xx status with a response body longer than the bound
- **THEN** the thrown error's message SHALL contain a truncated, whitespace-collapsed form of the body (with an ellipsis indicator)

#### Scenario: Oversized ingest error body is truncated
- **WHEN** `callIngestNote` receives a non-2xx status with an oversized response body
- **THEN** the thrown error's message SHALL contain a truncated form of the body

#### Scenario: Short bodies are preserved
- **WHEN** the response body is within the bound (e.g. "content is required")
- **THEN** the message SHALL contain the body unchanged

### Requirement: AI-output responses validated at the client boundary

The plugin SHALL validate the shape of AI-output poll responses at the API-client boundary before using them, rather than casting untrusted server data to the expected type. A response whose `data` payload is not the expected array of objects SHALL be treated as an error (surfaced in a Notice on a manual pull, logged on a background poll) and SHALL NOT drive any vault write.

#### Scenario: Well-formed metadata response is accepted
- **WHEN** the plugin polls `get-pending-ai-output-metadata` and the server returns `data` as an array of objects each having `id`, `title`, `file_path`, `content_size`, and `created_at`
- **THEN** the plugin SHALL proceed with conflict detection and the confirmation dialog as normal

#### Scenario: Malformed metadata response is rejected, not cast
- **WHEN** the plugin polls `get-pending-ai-output-metadata` and the server returns `data` that is not an array of the expected object shape (e.g. a string, an object, or an array of non-objects)
- **THEN** the plugin SHALL raise an error instead of casting the value
- **AND** SHALL NOT open the confirmation dialog or write any file
- **AND** SHALL surface the error in a Notice when the poll was manual, or log it when the poll was automatic

#### Scenario: Malformed content response is rejected, not cast
- **WHEN** the plugin fetches `fetch-ai-output-content` after user acceptance and the server returns `data` that is not an array of objects each having `id` and `content`
- **THEN** the plugin SHALL raise an error instead of casting the value
- **AND** SHALL NOT write any file for that delivery

### Requirement: Obsolete settings keys are dropped on load

On load the plugin SHALL remove obsolete settings keys — including the retired `projectsFolderBase` field and the legacy `debounceMs`/`pollIntervalMs` fields — from the in-memory settings object, and SHALL persist the cleaned settings once when any obsolete key was present. Removal SHALL NOT affect any live setting or stored `syncedHashes`.

#### Scenario: Retired projectsFolderBase key is removed
- **WHEN** the plugin loads persisted settings that contain a `projectsFolderBase` field
- **THEN** the in-memory settings object SHALL NOT contain `projectsFolderBase`
- **AND** the cleaned settings SHALL be persisted once
- **AND** all other settings values and `syncedHashes` SHALL be preserved

#### Scenario: No persist when nothing obsolete is present
- **WHEN** the plugin loads persisted settings that contain no obsolete keys
- **THEN** the plugin SHALL NOT perform an extra persistence write on account of key cleanup

### Requirement: Single-flight sync per file

The sync engine SHALL never run two overlapping `processNote` executions for the same file path. While a sync for a path is in flight, any further sync request for that path SHALL be coalesced into the in-flight run (all callers receive the in-flight run's outcome), and exactly one ingest request SHALL be sent.

#### Scenario: Concurrent manual sync coalesces with in-flight sync
- **WHEN** a sync for a file is in flight (awaiting the ingest call)
- **AND** the user triggers a manual sync (command or ribbon) for the same file
- **THEN** no second ingest request SHALL be sent
- **AND** both callers SHALL receive the outcome of the single in-flight run

#### Scenario: In-flight tracking is cleared after completion
- **WHEN** a sync for a file completes (success or failure)
- **THEN** a subsequent sync request for that file SHALL start a fresh run

### Requirement: Unload cancels all scheduled work

After plugin unload, no timer, retry, or poll owned by the plugin SHALL fire. This includes per-file debounce timers, retry re-scheduling from a sync that was already in flight at unload time, the startup poll delay, and the poll interval.

#### Scenario: Failed in-flight sync does not reschedule after unload
- **WHEN** a scheduled sync is awaiting its ingest call
- **AND** the plugin is unloaded (timers cleared) before the call resolves
- **AND** the call then resolves as failed
- **THEN** no retry timer SHALL be scheduled

#### Scenario: Startup poll timeout is cleared on unload
- **WHEN** the plugin is unloaded within the startup poll delay window
- **THEN** the startup poll SHALL NOT fire

#### Scenario: Poll interval is cleared on unload
- **WHEN** the plugin is unloaded
- **THEN** the poll interval SHALL be cleared and no further automatic polls SHALL run

### Requirement: Response envelope validated at the client boundary

The API client SHALL validate the HTTP response envelope before reading properties from it. A 200 response whose body is not valid JSON, or whose parsed value is not a plain object, SHALL be surfaced as a descriptive error — never as a raw `SyntaxError` or `TypeError`. The envelope's `error` field SHALL only be used when it is a string.

#### Scenario: Non-JSON 200 body yields a friendly error
- **WHEN** the server returns HTTP 200 with a non-JSON body (e.g. proxy or captive-portal HTML)
- **THEN** the client SHALL reject with a message stating the server returned a non-JSON response

#### Scenario: Non-object envelope yields a friendly error
- **WHEN** the server returns HTTP 200 with a JSON body of `null`, a string, or a number
- **THEN** the client SHALL reject with a malformed-envelope error, not a `TypeError`

### Requirement: Caught errors are rendered safely regardless of thrown shape

Every catch site that renders a caught value to the user SHALL derive the message via a shared helper that handles non-`Error` throws (`error instanceof Error ? error.message : String(error)`). A rejection with a string or plain object SHALL never crash inside the catch handler or become an unhandled rejection.

#### Scenario: Manual poll failure with a non-Error rejection still notifies
- **WHEN** a manual AI-output pull fails with a rejected value that is a plain string
- **THEN** the user SHALL see a failure Notice containing that string
- **AND** no unhandled rejection SHALL occur

### Requirement: Minute settings are range-clamped at the load boundary

When loading persisted settings, `syncDelayMinutes` and `pollIntervalMinutes` SHALL be accepted only when finite and `>= 1`; any other value (zero, negative, `NaN`, non-finite) SHALL fall back to the default. The clamp SHALL also apply to values produced by the legacy millisecond-settings migration.

#### Scenario: Corrupted poll interval falls back to default
- **WHEN** persisted data contains `pollIntervalMinutes: 0`, a negative value, or `NaN`
- **THEN** the loaded settings SHALL use the default poll interval
- **AND** no zero-millisecond interval SHALL ever be scheduled

#### Scenario: Corrupted sync delay falls back to default
- **WHEN** persisted data contains `syncDelayMinutes: 0`, a negative value, or `NaN`
- **THEN** the loaded settings SHALL use the default sync delay

### Requirement: Frontmatter stripping is precise

`stripFrontmatter` SHALL remove a leading block only when it is genuine YAML frontmatter: `---` as the entire first line, with a closing `---` on its own line. A note that merely begins with a markdown horizontal rule SHALL NOT lose content.

#### Scenario: Leading horizontal rule is preserved
- **WHEN** a note begins with `---` used as a horizontal rule (content follows on the same or next lines without a closing `---` line pair forming frontmatter)
- **THEN** the note content SHALL be unchanged by frontmatter stripping

#### Scenario: Real frontmatter is still stripped
- **WHEN** a note begins with a `---` line, YAML lines, and a closing `---` line
- **THEN** the frontmatter block SHALL be removed and the body preserved

### Requirement: Forced-sync read failures are reported as failures

During a forced sync (manual note sync or full-vault sync), a file-read failure SHALL count as a `failed` outcome, not `skipped`. The unforced debounce path MAY continue to treat a read failure as `skipped` (the file may have been deleted during the delay).

#### Scenario: Vault sync with an unreadable file reports failure
- **WHEN** a full-vault sync processes one readable and one unreadable file
- **THEN** the summary SHALL report 1 synced and 1 failed (0 skipped)
- **AND** the completion notice SHALL be the failure variant, not "Vault sync complete"

### Requirement: Invalid numeric settings input gives feedback

When the user enters an invalid value (non-numeric or `< 1`) in a minutes settings field, the plugin SHALL show feedback explaining the constraint and reset the field to the stored value, instead of silently keeping the old setting while the field displays the rejected text.

#### Scenario: Entering zero in the poll interval field
- **WHEN** the user types `0` (or `abc`, or `-3`) into a minutes field
- **THEN** the stored setting SHALL remain unchanged
- **AND** the user SHALL see feedback that a whole number ≥ 1 is required
- **AND** the field SHALL be reset to display the stored value

