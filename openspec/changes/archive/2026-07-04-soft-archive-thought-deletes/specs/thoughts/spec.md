## ADDED Requirements

### Requirement: ingest_note reconciliation soft-archives removed thoughts

During `ingest_note` reconciliation, thoughts in the LLM plan's `delete` list SHALL be soft-archived by setting `archived_at = now()`, and SHALL NOT be removed from the database with a SQL `DELETE`. This prevents a hallucinated or incorrect LLM-produced ID from permanently destroying captured knowledge. Archived thoughts remain retrievable (consistent with `archive_thought`) and, because the reconciliation fetch filters `archived_at IS NULL`, are excluded from subsequent reconciliations so they do not resurface as spurious existing thoughts.

This requirement supersedes the earlier reconciliation step statement "Deleted thoughts are removed from the database."

#### Scenario: Reconciliation removal archives instead of deleting
- **WHEN** `ingest_note` reconciles an existing note and the LLM plan marks one or more thought IDs in its `delete` list
- **THEN** each such thought row SHALL still exist in the `thoughts` table with `archived_at` set to a non-null timestamp
- **THEN** no `thoughts` row referenced by the note SHALL be permanently deleted

#### Scenario: Archived thought excluded from next reconciliation
- **WHEN** a thought was soft-archived by a prior reconciliation and `ingest_note` runs again for the same note
- **THEN** the archived thought SHALL NOT appear in the fetched existing-thoughts set and SHALL NOT be presented to the reconciliation LLM

#### Scenario: Summary still reports removed count
- **WHEN** `ingest_note` reconciliation archives one or more thoughts from the `delete` list
- **THEN** the returned summary SHALL count those thoughts as "removed" (the user-facing meaning is unchanged — the thought is no longer part of the active note)
