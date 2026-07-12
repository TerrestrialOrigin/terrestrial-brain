## ADDED Requirements

### Requirement: End-to-end provisioning pipeline

The system SHALL provision a single customer brain by executing an ordered pipeline — create Supabase project, wait until the project is healthy, apply all migrations, set per-project secrets, deploy the `terrestrial-brain-mcp` edge function, health-check the deployed endpoint — and SHALL return the customer-facing connection details (MCP URL and access key) only when every step has succeeded. It MUST NOT report success if any step failed.

#### Scenario: Full provision succeeds
- **WHEN** the pipeline is invoked for a new customer with a valid region and all external calls succeed
- **THEN** a project is created, migrations are applied, secrets are set, the edge function is deployed, the health-check passes, and the pipeline returns `{ mcpUrl, accessKey }` with a non-empty access key

#### Scenario: A step fails
- **WHEN** any pipeline step returns a failure
- **THEN** the pipeline stops, does not return connection details, and records the job as `failed` with the failing step and error details

### Requirement: Region is a validated parameter

The system SHALL accept the target region as a parameter and SHALL validate it against an allowlist of supported Supabase regions before any external call. An unsupported or malformed region MUST be rejected at the boundary. EU customers SHALL be provisionable into an EU region.

#### Scenario: Supported EU region
- **WHEN** the pipeline is invoked with a supported EU region
- **THEN** the create-project call is issued for that EU region

#### Scenario: Unsupported region
- **WHEN** the pipeline is invoked with a region not on the allowlist
- **THEN** the pipeline rejects the request with a validation error naming the invalid region and makes no create-project call

### Requirement: Provisioning is idempotent per customer

The system SHALL treat the customer identifier as the idempotency key and SHALL NOT create more than one project for the same customer. Re-invoking provisioning for a customer whose brain is already completed SHALL return the existing connection details without creating a new project.

#### Scenario: Re-provision an already-completed customer
- **GIVEN** a customer whose provisioning job is already `done`
- **WHEN** the pipeline is invoked again for that customer
- **THEN** it returns the existing `{ mcpUrl, accessKey }` and issues no create-project call

#### Scenario: Run twice concurrently is still one project
- **WHEN** the pipeline is invoked twice for the same customer within one run
- **THEN** exactly one create-project call is made across both invocations

### Requirement: Provisioning resumes after a crash without duplicating work

The system SHALL persist the external project reference before marking project-creation complete, and SHALL mint the customer access key exactly once and persist it at mint time. A job that failed or was interrupted part-way SHALL resume from its last completed step, reusing the persisted project reference and access key rather than creating a new project or rotating the key.

#### Scenario: Resume after a mid-pipeline crash
- **GIVEN** a job that completed project creation and then failed before deploying the function
- **WHEN** the pipeline is invoked again for that customer
- **THEN** it does not create a second project, reuses the persisted project reference and access key, resumes at the next incomplete step, and completes successfully

#### Scenario: Project reference survives a crash immediately after creation
- **GIVEN** the create-project call has returned but the process crashes before the step is marked complete
- **WHEN** the job is reloaded
- **THEN** the persisted job already carries the created project reference so recovery does not create a duplicate

### Requirement: Concurrent provisioning for one customer is serialized

The system SHALL claim a provisioning job atomically (compare-and-swap on status with an owner lease) so that only one worker provisions a given customer at a time. A second concurrent attempt SHALL be told the job is already in progress rather than starting a parallel provision.

#### Scenario: Second concurrent attempt is rejected
- **GIVEN** a job that is `running` under a live lease
- **WHEN** a second provisioning attempt tries to claim the same customer
- **THEN** the claim is refused and the second attempt reports "already in progress" without issuing external calls

#### Scenario: Expired lease is reclaimable
- **GIVEN** a `running` job whose owner lease has expired
- **WHEN** a new provisioning attempt claims the same customer
- **THEN** the claim succeeds and provisioning resumes from the last completed step

### Requirement: Failure is recoverable and rollback is explicit

The system SHALL leave a failed provision in a recoverable `failed` state that retains the step cursor, error details, and any created project reference. Automatic teardown of a partially-created project SHALL be off by default; the system SHALL provide an explicit rollback operation (and an opt-in auto-rollback flag) that best-effort deletes the created project.

#### Scenario: Failed job is left recoverable, not deleted
- **WHEN** provisioning fails after the project was created and auto-rollback is not enabled
- **THEN** the project is not deleted, and the job records `failed` with the cursor, error details, and project reference

#### Scenario: Explicit rollback deletes the project
- **WHEN** the rollback operation is invoked for a customer with a recorded project reference
- **THEN** it issues a best-effort project-delete for that reference and marks the job rolled back

### Requirement: External dependencies are injected behind seams

The system SHALL access every external dependency — the Supabase Management API, the migration/deploy runner, the job store, the clock, and access-key generation — through a narrow injected interface wired at one composition root, and SHALL provide a deterministic fake for each so the full pipeline runs in tests with no network, no live Supabase organization, and no paid API.

#### Scenario: Full pipeline runs against fakes
- **WHEN** the pipeline is executed with fake implementations of every external dependency
- **THEN** it completes a full provision end-to-end without any real network, Supabase, or paid-API call

### Requirement: Secrets are handled confidentially

The system SHALL read the privileged Management API token and the OpenRouter key from validated environment configuration, SHALL transmit the Management token in an `Authorization` header (never in a URL or query string), SHALL generate the per-customer access key with a cryptographically secure generator, SHALL write any on-disk job-store file with owner-only (0600) permissions, and MUST NOT emit any secret value to logs.

#### Scenario: Missing required secret fails fast
- **WHEN** a required secret environment variable is unset or empty
- **THEN** configuration loading throws an error naming the variable and no provisioning proceeds

#### Scenario: No secret appears in logs
- **WHEN** a full provision runs and emits log output
- **THEN** no Management token, OpenRouter key, or customer access key value appears in the emitted logs
