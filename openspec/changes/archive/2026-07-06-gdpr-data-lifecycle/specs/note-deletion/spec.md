## ADDED Requirements

### Requirement: Backend forget-note erasure tool and route

The system SHALL provide an MCP tool `forget_note` and an HTTP route `POST /forget-note` that, given a note's `reference_id` (`note_id`), permanently erase that note's backend footprint: it SHALL hard-delete every `thoughts` row whose `note_snapshot_id` matches the note's snapshot, then hard-delete the `note_snapshots` row itself. Both entry points SHALL require the `x-brain-key` access key like every other tool/route. Erasure SHALL be scoped to the single `reference_id` — no bulk or wildcard deletion — and SHALL NOT delete tasks, projects, or people.

#### Scenario: Forget an existing synced note
- **WHEN** `forget_note` (or `POST /forget-note`) is called with a `note_id` that has a stored `note_snapshots` row and derived `thoughts`
- **THEN** all `thoughts` with that snapshot's `note_snapshot_id` SHALL be permanently deleted (not archived)
- **AND** the `note_snapshots` row SHALL be permanently deleted
- **AND** the response SHALL report success with a count of what was removed

#### Scenario: Thoughts are deleted before the snapshot
- **WHEN** `forget_note` executes
- **THEN** the derived thoughts SHALL be deleted before the snapshot row, so an interruption between the two steps leaves the snapshot still resolvable and a re-run can complete the erasure

#### Scenario: Unrelated notes are untouched
- **WHEN** `forget_note` is called for one `note_id`
- **THEN** snapshots and thoughts belonging to any other `reference_id` SHALL remain intact

#### Scenario: Access key required
- **WHEN** `POST /forget-note` is called without a valid `x-brain-key`
- **THEN** the request SHALL be rejected with 401 and no data SHALL be deleted

#### Scenario: Missing or empty note_id is rejected
- **WHEN** `POST /forget-note` is called with a missing or empty `note_id`
- **THEN** the route SHALL return a 400 error with a clear message and delete nothing

### Requirement: Forget-note is idempotent

The system SHALL treat `forget_note` for a `reference_id` with no stored snapshot as a successful no-op, and SHALL treat re-running `forget_note` on an already-erased note as a successful no-op. Erasing an unsynced, excluded, or already-forgotten note SHALL NOT surface as an error.

#### Scenario: Forget a note that was never synced
- **WHEN** `forget_note` is called with a `note_id` that has no `note_snapshots` row
- **THEN** the call SHALL succeed reporting that nothing needed to be forgotten
- **AND** no error SHALL be raised

#### Scenario: Forget the same note twice
- **WHEN** `forget_note` is called a second time for a note already erased by a first call
- **THEN** the second call SHALL succeed as a no-op

### Requirement: Plugin erases backend data on vault-note deletion

The Obsidian plugin SHALL, when an eligible (non-excluded) markdown note is deleted from the vault, call the backend forget-note endpoint for that note's path in addition to clearing the local content hash. A failure of the backend call SHALL surface a user Notice but SHALL NOT throw out of the delete handler or prevent the local hash cleanup.

#### Scenario: Deleting a synced note erases it in the backend
- **WHEN** an eligible markdown note that was previously synced is deleted in the vault
- **THEN** the plugin SHALL call the forget-note endpoint with the note's vault-relative path
- **AND** SHALL drop the note's local content hash

#### Scenario: Backend forget failure does not crash the delete handler
- **WHEN** the forget-note call fails (backend unreachable)
- **THEN** the plugin SHALL surface a Notice describing the failure
- **AND** SHALL still complete local hash cleanup without throwing

### Requirement: Plugin command to forget a specific note on demand

The plugin SHALL register a command "Forget this note in Terrestrial Brain" that erases the backend data for the currently active note without deleting the vault file. If there is no active markdown note, the command SHALL show a Notice and make no backend call.

#### Scenario: Command forgets the active note
- **WHEN** the user runs "Forget this note in Terrestrial Brain" with a markdown note active
- **THEN** the plugin SHALL call the forget-note endpoint with the active note's vault-relative path
- **AND** SHALL show a Notice reporting the outcome

#### Scenario: Command with no active note
- **WHEN** the command is run with no active markdown note
- **THEN** the plugin SHALL show a Notice prompting the user to open a note
- **AND** SHALL make no backend call

### Requirement: Data-flow disclosure

The system SHALL disclose, in the plugin settings description and the README, what data leaves the vault (note content and title), where it is stored (backend `note_snapshots` and derived `thoughts`, plus `function_call_logs`), and how to erase it (delete the note or run the forget command; log retention purges automatically).

#### Scenario: Disclosure is present
- **WHEN** a user reads the plugin settings or the README
- **THEN** they SHALL find a statement of what is sent to the backend, what is stored, and how to erase a note's data
