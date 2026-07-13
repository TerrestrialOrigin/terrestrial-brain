# deprovision-and-export Specification

## Purpose
TBD - created by archiving change deprovision-and-export. Update Purpose after archive.
## Requirements
### Requirement: Non-destructive data export produces a complete, delivered, verified dump

The system SHALL provide a non-destructive `export` operation that, given a customer id, produces a complete logical dump of that customer's project data, delivers it to the customer's configured destination, and verifies the delivered artifact (checksum and byte count) before reporting success. The operation SHALL make no destructive change and SHALL be repeatable — running it again delivers a fresh dump without side effects. The returned manifest SHALL record only the delivery location, checksum, byte count, and per-table row counts, and SHALL contain no note or thought content.

#### Scenario: A successful export delivers and verifies a dump
- **GIVEN** a customer with a completed (`done`) provisioning record
- **WHEN** the export operation runs
- **THEN** a complete dump is delivered to the customer's destination, the delivered artifact is verified against its checksum and byte count, and the operation returns a manifest reporting the location, checksum, byte count, and table row counts

#### Scenario: A failed or truncated delivery does not report success
- **GIVEN** an export whose delivered artifact does not match its computed checksum or byte count
- **WHEN** verification runs
- **THEN** the operation reports failure with the mismatch detail and does not report a successful export

#### Scenario: The export manifest carries no customer content
- **WHEN** an export completes and its manifest is returned or logged
- **THEN** the manifest contains only the location, checksum, byte count, and row counts — no note or thought content appears in the manifest or the logs

### Requirement: Deprovision exports and verifies before it deletes

The system SHALL provide a destructive `deprovision` operation that runs as an ordered sequence — export the customer's data, verify the delivered export, THEN delete the project, THEN finalize. The delete step SHALL be unreachable until verification of the export has completed. The system SHALL persist the export manifest before the delete step, so an interruption after a verified export leaves a recoverable state that resumes at the delete rather than re-doing the export.

#### Scenario: Deletion happens only after a verified export
- **GIVEN** a customer being deprovisioned
- **WHEN** the export verification fails
- **THEN** the project delete is never attempted, the job is recorded `failed` with the verification error, and the customer's project remains intact

#### Scenario: A verified export precedes a successful delete
- **GIVEN** a customer whose export delivers and verifies successfully
- **WHEN** deprovision continues
- **THEN** the project is deleted exactly once after the export is verified

#### Scenario: Interruption after a verified export resumes at the delete
- **GIVEN** a deprovision that completed and persisted its export manifest but was interrupted before the delete
- **WHEN** the deprovision is re-run
- **THEN** it resumes at the delete step using the persisted manifest and does not re-export destructively

### Requirement: Deprovision is idempotent and single-project scoped

The system SHALL delete only the single project recorded on the target customer's own provisioning job — never a bulk or wildcard delete. Deprovision SHALL be idempotent: concurrent runs for one customer SHALL result in exactly one deletion, a re-run after a partial delete SHALL complete without error (a project already gone is treated as a successful deletion), and a customer already deprovisioned SHALL be a successful no-op that neither re-exports nor re-deletes.

#### Scenario: Concurrent deprovision runs delete once
- **GIVEN** two deprovision runs started for the same customer
- **WHEN** they contend for the deprovision job
- **THEN** exactly one run proceeds and the other reports the job already in progress, and the project is deleted at most once

#### Scenario: Re-running after the project is already gone succeeds
- **GIVEN** a customer whose project deletion has already happened
- **WHEN** deprovision is run again
- **THEN** it treats the missing project as a successful deletion and does not error

#### Scenario: An already-deprovisioned customer is a clean no-op
- **GIVEN** a customer already marked deprovisioned
- **WHEN** deprovision is invoked again
- **THEN** it succeeds without re-exporting or re-deleting

### Requirement: Deprovision reports an honest counted outcome and keeps the fleet consistent

The system SHALL report a customer as `deprovisioned` only when the export verified AND the project delete succeeded; any step failing SHALL record the job `failed` with its error and return a non-success outcome — success SHALL NOT be asserted merely because a sequence completed. On successful deprovision the system SHALL transition the customer's provisioning job to a `deprovisioned` status so fleet enumeration (which counts only `done` jobs) no longer operates on the deleted project.

#### Scenario: A half-completed deprovision is not reported as done
- **GIVEN** a deprovision whose delete step fails after a verified export
- **WHEN** the outcome is reported
- **THEN** the customer is recorded `failed` with the delete error and is not reported `deprovisioned`

#### Scenario: A completed deprovision leaves the fleet consistent
- **GIVEN** a customer whose export verified and whose project was deleted
- **WHEN** deprovision finalizes
- **THEN** the customer's provisioning job is transitioned to `deprovisioned` and is excluded from the fleet's `done`-only enumeration

### Requirement: Deprovision and export guard on the customer's provisioning state

The system SHALL, before exporting or deleting, load the customer's provisioning record and act only on a valid target. A customer with no provisioning record SHALL be reported not-found and SHALL NOT be exported or deleted. A customer whose provisioning status is not `done` (still running, failed, or rolled back) SHALL be refused with a clear message and SHALL NOT be deleted. The project reference used for deletion SHALL come from the customer's own provisioning record, never from free-text operator input.

#### Scenario: An unknown customer is reported, not silently skipped
- **WHEN** deprovision or export is invoked for a customer with no provisioning record
- **THEN** it reports the customer as not found, returns a non-success outcome, and deletes nothing

#### Scenario: A customer whose provisioning did not complete is refused
- **WHEN** deprovision is invoked for a customer whose provisioning status is not `done`
- **THEN** it is refused with a clear message and the project is not deleted

### Requirement: Deprovision and export reuse the provisioning seams and add only narrow, injected dependencies

The system SHALL access every external dependency — the data exporter, the Supabase Management API, the provisioning job store, the deprovision job store, the clock, and logging — through narrow injected interfaces wired at the one composition root, and SHALL provide a deterministic fake for each so the full deprovision and export flows run in tests with no network, no live Supabase organization, and no paid API. No Management API token, per-customer database password, or dumped customer content SHALL appear in log output.

#### Scenario: Full deprovision flow runs against fakes
- **WHEN** the deprovision and export operations are executed with fake implementations of every external dependency
- **THEN** they complete end-to-end without any real network, Supabase, or paid-API call

#### Scenario: No secret or content appears in logs
- **WHEN** a full deprovision run emits log output
- **THEN** no Management API token, no per-customer database password, and no dumped customer content appears in the emitted logs
