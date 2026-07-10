## MODIFIED Requirements

### Requirement: Backend forget-note erasure tool and route

The system SHALL provide an MCP tool `forget_note` and an HTTP route `POST /forget-note` that, given a note's `reference_id` (`note_id`), permanently erase that note's backend footprint: it SHALL hard-delete every `thoughts` row whose `note_snapshot_id` matches the note's snapshot, then hard-delete the `note_snapshots` row itself. Both entry points SHALL require the `x-tb-key` access key like every other tool/route. Erasure SHALL be scoped to the single `reference_id` — no bulk or wildcard deletion — and SHALL NOT delete tasks, projects, or people.

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
- **WHEN** `POST /forget-note` is called without a valid `x-tb-key`
- **THEN** the request SHALL be rejected with 401 and no data SHALL be deleted

#### Scenario: Missing or empty note_id is rejected
- **WHEN** `POST /forget-note` is called with a missing or empty `note_id`
- **THEN** the route SHALL return a 400 error with a clear message and delete nothing
