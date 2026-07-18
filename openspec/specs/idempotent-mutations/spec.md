# idempotent-mutations Specification

## Purpose
TBD - created by archiving change rollback-and-idempotency. Update Purpose after archive.
## Requirements
### Requirement: Retried pickup and rejection are idempotent

The `markPickedUp` and `reject` methods of the AI-output repository SHALL be claim-style: the update SHALL only affect rows still in the pre-transition state (`picked_up = false` for pickup, `rejected = false` for rejection). A second call for a row already in the target state SHALL leave that row's transition timestamp (`picked_up_at` / `rejected_at`) unchanged and SHALL still report success, so an at-least-once client retry neither re-stamps the time nor re-surfaces an already-reported delivery.

#### Scenario: Re-marking an already-picked-up output does not re-stamp the time

- **WHEN** `markPickedUp` is called for an output id, and then called again for the same id
- **THEN** the row's `picked_up_at` SHALL equal the value set by the first call
- **AND** the second call SHALL report success

#### Scenario: An already-reported pickup does not reappear in recent activity

- **GIVEN** an output was picked up and reported in `get_recent_activity`
- **WHEN** the pickup call is retried after the reporting window's `since` cutoff
- **THEN** the output SHALL NOT reappear in `listDeliveredAiOutputsSince` results, because `picked_up_at` was not advanced

#### Scenario: Re-rejecting an already-rejected output does not re-stamp the time

- **WHEN** `reject` is called for an output id, and then called again for the same id
- **THEN** the row's `rejected_at` SHALL equal the value set by the first call
- **AND** the second call SHALL report success

### Requirement: Retried archival preserves the original archived time

The plain archival methods `archive` and `archiveMany` on the task repository, `archive` on the person repository, and `archive` on the thought repository SHALL only affect rows that are still active (`archived_at IS NULL`). Re-running an archival on an already-archived row SHALL leave that row's `archived_at` unchanged, so a retried mutation cannot corrupt the original archival timestamp.

#### Scenario: Re-archiving a task preserves archived_at

- **WHEN** a task is archived, and then the same archive method is called again for that task
- **THEN** the task's `archived_at` SHALL equal the value set by the first archive

#### Scenario: archiveMany skips already-archived tasks

- **WHEN** `archiveMany` is called for a set of task ids of which some were already archived
- **THEN** the already-archived tasks' `archived_at` values SHALL remain unchanged

#### Scenario: Re-archiving a person preserves archived_at

- **WHEN** a person is archived, and then the same archive method is called again for that person
- **THEN** the person's `archived_at` SHALL equal the value set by the first archive

#### Scenario: Re-archiving a thought preserves archived_at

- **WHEN** a thought is archived, and then the same archive method is called again for that thought
- **THEN** the thought's `archived_at` SHALL equal the value set by the first archive

