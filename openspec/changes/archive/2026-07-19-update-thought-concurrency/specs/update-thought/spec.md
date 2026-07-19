# update-thought — Delta (update-thought-concurrency)

## ADDED Requirements

### Requirement: Concurrent edits are detected, never silently lost

`update_thought` SHALL perform its read-modify-write with an optimistic-concurrency guard: the `updated_at` value read with the existing thought MUST be passed to the update, and the update MUST match zero rows when the thought has been modified since that read. When zero rows match, the tool SHALL return an explicit error instructing the caller to re-read and retry, and MUST NOT report success. A write from a fresh snapshot proceeds unchanged.

#### Scenario: Interleaved update from a stale snapshot is rejected

- **WHEN** two actors read the same thought snapshot and the first actor's update commits
- **THEN** the second actor's update (carrying the stale `updated_at`) matches zero rows
- **AND** the second actor receives a "concurrent edit" error telling them to re-read and retry
- **AND** the first actor's written fields (including reference arrays) are preserved

#### Scenario: Update from a fresh snapshot succeeds

- **WHEN** an actor reads a thought and updates it before any other write intervenes
- **THEN** the update matches the row and the tool returns its normal confirmation
