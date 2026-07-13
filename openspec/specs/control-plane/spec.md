# control-plane Specification

## Purpose
TBD - created by archiving change control-plane. Update Purpose after archive.
## Requirements

> **Test tier:** every scenario below is tagged `test` (deterministic). The control plane has no LLM behavior, so there is no `eval` tier. Deterministic scenarios run against the in-memory `ControlPlaneClient` fake (no live Supabase); real-system confidence comes from an opt-in, fail-loud live smoke.

### Requirement: The control plane is one ordinary Supabase project mapping customers to projects, tokens, and subscription status

The system SHALL provide a durable control plane backed by one ordinary Supabase project whose schema maps each customer to their provisioned project (project ref, region, MCP URL, provisioning status and resume cursor), their subscription status, their stored secrets, their deprovision job, and their delivered export artifacts. Every control-plane table SHALL be accessible only to the service role (no anonymous or authenticated-user access). The schema SHALL be applied idempotently by a maintenance operation so applying it more than once is safe.

#### Scenario: Applying the schema is idempotent
- **WHEN** the control-plane schema-apply operation runs against a project that already has the schema
- **THEN** it completes successfully and makes no destructive change to existing rows

#### Scenario: The control plane maps a customer to their connection and status
- **GIVEN** a provisioned customer recorded in the control plane
- **WHEN** the control plane is queried for that customer
- **THEN** it returns the customer's project ref, region, MCP URL, provisioning status, and subscription status

#### Scenario: Control-plane tables are service-role only
- **WHEN** the control-plane schema is applied
- **THEN** no table grants access to the anonymous or authenticated roles, and every table is reachable only with the service-role credential

### Requirement: Durable database-backed job stores replace the interim file stores with no change to step or pipeline logic

The system SHALL provide database-backed implementations of the existing `ProvisioningJobStore` and `DeprovisionJobStore` seams, backed by the control plane, selected by configuration. Selecting the control-plane backend SHALL NOT change any provisioning, fleet, or deprovision step or pipeline logic — the in-memory job shape those pipelines operate on SHALL be identical to the file-backed store's. The interim file-backed store SHALL remain available as a configured development fallback. Selecting the control-plane backend without valid control-plane configuration SHALL fail fast at startup, naming the missing configuration.

#### Scenario: The control-plane store round-trips a full job
- **GIVEN** the control-plane store backend is selected
- **WHEN** a provisioning job is saved and then loaded
- **THEN** the loaded job equals the saved job in every field the pipeline reads, including the once-minted access key and db password

#### Scenario: A crashed provision resumes from its persisted cursor
- **GIVEN** a provisioning job persisted with a partially-advanced cursor and its minted access key
- **WHEN** the job is reloaded from the control-plane store
- **THEN** it resumes at the recorded cursor and reuses the same access key, never re-minting or duplicating completed work

#### Scenario: Selecting the control-plane backend without configuration fails fast
- **GIVEN** the store backend is set to control-plane but the control-plane URL or service key is absent
- **WHEN** the application wires its dependencies
- **THEN** it fails at startup with an error naming the missing configuration, and does not run with a half-wired store

### Requirement: The atomic claim is enforced by the database

The control-plane job stores SHALL enforce the atomic claim (compare-and-swap on status and lease) with a single database conditional write, so that concurrent claims for one customer are resolved by the database rather than by a process-local check. A claim SHALL return `claimed` when the job is absent, failed, or its lease has expired; `in_progress` (with no mutation) when the job is already running under a live lease; and `already_done` when the job is complete.

#### Scenario: Two concurrent claims for one customer yield exactly one winner
- **GIVEN** two provisioning runs claiming the same customer's job concurrently
- **WHEN** both attempt the atomic claim
- **THEN** exactly one receives `claimed` and the other receives `in_progress`, and only one job is advanced

#### Scenario: An expired lease is reclaimable
- **GIVEN** a job left `running` with a lease whose expiry is in the past
- **WHEN** a new run attempts to claim it
- **THEN** the claim succeeds (`claimed`) and takes a fresh lease

#### Scenario: A completed job is reported already done
- **GIVEN** a customer whose provisioning job is `done`
- **WHEN** a claim is attempted
- **THEN** it returns `already_done` and the caller returns the existing connection details without re-provisioning

### Requirement: Secrets are stored in a service-role-only secret store and never exposed by customer-facing reads

The system SHALL store the minted MCP access key and the project db password in a dedicated service-role-only secret store, not in world-persisted plaintext files. Secret values SHALL never appear in log output and SHALL never be returned by the customer-facing service reads (customer listing or connection lookup). Secret access SHALL go through a `SecretStore` seam so the storage backend can be strengthened later without changing callers.

#### Scenario: Secrets round-trip through the secret store
- **WHEN** a customer's access key and db password are written and later read back through the secret store
- **THEN** the exact values are returned

#### Scenario: Customer-facing reads omit secrets
- **WHEN** the service layer lists customers or returns a customer's connection details
- **THEN** the result contains the project ref, region, MCP URL, and subscription status but contains no access key or db password

#### Scenario: Secrets and the service-role key never appear in logs
- **WHEN** control-plane operations run and produce log output
- **THEN** no access key, db password, or service-role key value appears anywhere in the logs

### Requirement: Delivered export artifacts are recorded content-free and purged on retention

The system SHALL record every delivered export artifact in the control plane with its location, checksum, byte size, row count, delivery time, and retention deadline, and SHALL record no note or thought content. The system SHALL provide a `purge-exports` operation that deletes only artifacts whose retention deadline has passed — both the delivered file and its record — using a bounded query, and SHALL return a counted outcome. The operation SHALL be idempotent (an artifact already gone counts as successfully purged) and SHALL report overall failure if any deletion failed.

#### Scenario: Only expired artifacts are purged
- **GIVEN** two recorded export artifacts, one past its retention deadline and one within it
- **WHEN** `purge-exports` runs
- **THEN** the expired artifact's file and record are deleted, the within-retention artifact is untouched, and the operation reports one purged and one skipped

#### Scenario: Purging with nothing due is a clean zero
- **GIVEN** no export artifacts are past their retention deadline
- **WHEN** `purge-exports` runs
- **THEN** it reports zero purged and succeeds, rather than erroring or reporting a false completion

#### Scenario: An export-artifact record carries no content
- **WHEN** an export artifact is recorded
- **THEN** its record contains only the location, checksum, byte size, row count, delivery time, and retention deadline — no note or thought content

### Requirement: A transport-neutral service layer exposes control-plane reads and writes for the dashboard and billing

The system SHALL expose a transport-neutral service layer providing the operations the future dashboard and billing webhooks consume: list customers, read a customer's connection and subscription status, set a customer's subscription status, and record and list export artifacts. `setSubscriptionStatus` SHALL be an idempotent upsert keyed by customer so an at-least-once webhook replay is a no-op, and SHALL refuse a customer that does not exist rather than silently creating one. The service logic SHALL be written once here so each future entry point (webhook handler, dashboard) is a thin adapter.

#### Scenario: Setting subscription status is idempotent
- **GIVEN** a known customer
- **WHEN** the same subscription status is set twice
- **THEN** the customer's status equals that value and the second call changes nothing else

#### Scenario: Setting status for an unknown customer is refused
- **GIVEN** a customer id with no control-plane record
- **WHEN** `setSubscriptionStatus` is called for it
- **THEN** the operation reports a not-found error and creates no customer row

#### Scenario: A malformed control-plane row is rejected at read time
- **GIVEN** a control-plane row that does not match the expected schema
- **WHEN** the service layer reads it
- **THEN** it fails with a validation error at the boundary rather than returning an unchecked value
