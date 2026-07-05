## MODIFIED Requirements

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

## ADDED Requirements

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
