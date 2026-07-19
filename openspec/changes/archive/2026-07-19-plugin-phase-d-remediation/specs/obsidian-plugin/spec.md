## ADDED Requirements

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

## MODIFIED Requirements

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
