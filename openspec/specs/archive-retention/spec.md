# archive-retention

## Purpose

A bounded retention window and an explicit, confirmed, SQL-free erasure pathway for archived personal data across the archivable tables (`thoughts`, `projects`, `tasks`, `people`), satisfying GDPR storage-limitation and giving data-subject erasure requests a supported method (RPCs + CLI + a confirm-gated MCP tool).

## Requirements


### Requirement: Archived personal data has a bounded retention window

Archived rows in the archivable tables (`thoughts`, `projects`, `tasks`, `people`) SHALL be purged after a defined retention window (365 days) by a best-effort scheduled job (`purge-archived-rows-yearly`), so archived personal data is not retained indefinitely (GDPR storage-limitation).

#### Scenario: The retention job is scheduled where pg_cron is available
- **WHEN** the migrations are applied on an environment with pg_cron
- **THEN** a daily `purge-archived-rows-yearly` job exists that purges rows archived on or before 365 days ago

#### Scenario: Migration still applies without pg_cron
- **WHEN** the migrations are applied where pg_cron is unavailable (local/CI)
- **THEN** the migration succeeds and the purge RPCs are created (the schedule is skipped)

### Requirement: Archived rows can be counted and purged without hand-written SQL

The system SHALL provide service-role RPCs `count_archived_rows(target_table, archived_on_or_before)` and `purge_archived_rows(target_table, archived_on_or_before)` over the four archivable tables. With no `target_table`, they operate on all four tables; with a `target_table` (validated against an allowlist) and `archived_on_or_before` date, they operate only on that table's rows archived on that date or earlier. `count_*` deletes nothing; `purge_*` hard-deletes and returns per-table deleted counts. Both SHALL report the documents that a project purge would cascade-delete, so that collateral is never silent.

#### Scenario: Targeted purge deletes only matching archived rows
- **WHEN** `purge_archived_rows('people', D)` runs
- **THEN** only `people` rows with `archived_at` on `D` or earlier are deleted; non-archived people, people archived after `D`, and other tables are untouched

#### Scenario: Unfiltered purge removes all archived rows
- **WHEN** `purge_archived_rows(null, null)` runs
- **THEN** every archived row in all four archivable tables is deleted and non-archived rows remain

#### Scenario: Unknown table is rejected
- **WHEN** either RPC is called with a `target_table` not in the allowlist
- **THEN** it raises an error and deletes nothing

#### Scenario: Project cascade is reported
- **WHEN** archived projects are in scope
- **THEN** the count/purge result includes a `documents (via project cascade)` count for documents belonging to those projects

### Requirement: Destructive purges require a dry-run and explicit confirmation

Every manual entry point SHALL show what would be deleted before deleting and require explicit confirmation. The MCP tool `purge_archived` SHALL return dry-run counts unless `confirm: true` is passed. The CLI `scripts/purge-archived.sh` SHALL print `count_archived_rows` output first and require typing `PURGE` for the delete-everything (no-argument) case, or a `--yes` flag for automation.

#### Scenario: MCP tool defaults to dry-run
- **WHEN** `purge_archived` is called without `confirm: true`
- **THEN** it returns per-table counts and deletes nothing

#### Scenario: MCP tool deletes only on explicit confirm
- **WHEN** `purge_archived` is called with `confirm: true`
- **THEN** it purges the matching archived rows and reports the deleted counts

#### Scenario: CLI requires confirmation for a full purge
- **WHEN** `scripts/purge-archived.sh` is run with no arguments and without `--yes`
- **THEN** it prints the per-table counts and refuses to delete until the operator types `PURGE`
