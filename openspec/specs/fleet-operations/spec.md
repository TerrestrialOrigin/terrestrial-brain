# fleet-operations Specification

## Purpose
TBD - created by archiving change fleet-operations. Update Purpose after archive.
## Requirements
### Requirement: Fleet enumeration from the provisioning job store

The system SHALL determine the fleet of operable customer projects from the provisioning job store, counting only jobs whose status is `done`. Enumeration SHALL be bounded (it reads the persisted set of jobs, not an unbounded external listing) and SHALL NOT include projects that TB did not provision.

#### Scenario: Only completed provisions are in the fleet
- **GIVEN** a job store containing a `done` job, a `failed` job, and a `running` job
- **WHEN** the fleet is enumerated
- **THEN** only the `done` job's project is included in the fleet

#### Scenario: An empty fleet is a success with zero projects
- **GIVEN** a job store with no `done` jobs
- **WHEN** a fleet operation is invoked
- **THEN** it reports a fleet of zero projects as a successful outcome, makes no external project calls, and does not error

### Requirement: Migration drift is detected per project

The system SHALL compute, for each fleet project, the set of local migration versions (from the pinned migration source) that are NOT yet applied on that project (read from the project's applied-migration record). A project with an empty difference SHALL be reported `in_sync`; a project with a non-empty difference SHALL report the specific missing versions as its drift. Drift detection SHALL be read-only and SHALL NOT apply any migration.

#### Scenario: A project missing migrations reports drift
- **GIVEN** the local source has versions [v1, v2, v3] and a project has applied [v1, v2]
- **WHEN** drift is detected for that project
- **THEN** its drift is [v3]

#### Scenario: A fully-applied project is in sync
- **GIVEN** the local source has versions [v1, v2] and a project has applied [v1, v2]
- **WHEN** drift is detected for that project
- **THEN** the project is reported `in_sync` with empty drift

#### Scenario: A missing or empty local migration source fails fast
- **WHEN** the local migration source path is missing or contains no migrations
- **THEN** drift detection fails at the boundary with an error naming the source, and no project is reported as `in_sync` on the basis of an absent source

### Requirement: Apply-migrations-to-all-projects is idempotent and per-project independent

The system SHALL apply the missing migrations to each drifted fleet project. Applying SHALL be idempotent — a project with no drift receives no apply call, and re-running the sweep after all projects are current issues no apply calls. Applying to one project SHALL be independent of the others; a failure on one project SHALL NOT prevent the remaining projects from being updated.

#### Scenario: Only drifted projects are migrated
- **GIVEN** a fleet with one in-sync project and one drifted project
- **WHEN** the migrate sweep runs
- **THEN** the drifted project receives exactly one apply call and the in-sync project receives none

#### Scenario: Re-running the sweep after it completes is a no-op
- **GIVEN** a fleet that the migrate sweep has already brought fully in sync
- **WHEN** the sweep runs again
- **THEN** no project receives an apply call

#### Scenario: Dry-run reports drift without applying
- **GIVEN** a fleet with at least one drifted project
- **WHEN** the migrate sweep runs in dry-run mode
- **THEN** the drift is reported per project and no project receives an apply call

### Requirement: The migrate sweep returns a counted outcome and never fakes success

The system SHALL return a per-project migration outcome (`in_sync`, `migrated`, or `failed`) for every fleet project plus a summary counting each status. A project whose drift detection or apply fails SHALL be recorded `failed` with its error detail, and the sweep SHALL continue to the remaining projects. The sweep SHALL report overall failure (non-zero exit status) if any project is `failed`, and SHALL count successes only from projects that actually ended in sync — never from the loop having completed.

#### Scenario: One failed project does not hide behind a green sweep
- **GIVEN** a fleet of two drifted projects where applying to the first throws
- **WHEN** the migrate sweep runs
- **THEN** the first project is recorded `failed` with its error, the second is recorded `migrated`, the sweep completes over both, and the overall outcome reports failure

#### Scenario: A scoped customer not in the fleet is reported, not silently skipped
- **WHEN** the migrate sweep is scoped to a customer id that is not a `done` job in the fleet
- **THEN** it reports that customer as not found and returns a non-success outcome rather than an empty success

### Requirement: Centralized fleet health and error monitoring

The system SHALL produce a fleet health report that, for each fleet project, records the project's platform health and a bounded count of recent errors from its function-call telemetry, and SHALL aggregate per-project statuses into a summary. Per-project status SHALL be one of `healthy`, `degraded` (reachable but recent error rate over the configured threshold), `unhealthy` (platform reports unhealthy), or `unreachable` (a health probe or telemetry query failed). Recent-error telemetry SHALL be bounded (a time window and an explicit limit/aggregate) and SHALL contain no note or thought content.

#### Scenario: A healthy project is reported healthy
- **GIVEN** a fleet project whose platform health is healthy and whose recent error count is below the threshold
- **WHEN** the monitor runs
- **THEN** the project is reported `healthy`

#### Scenario: A reachable project over the error threshold is degraded
- **GIVEN** a fleet project whose platform health is healthy but whose recent error count exceeds the threshold
- **WHEN** the monitor runs
- **THEN** the project is reported `degraded`

#### Scenario: An unreachable project is never reported as healthy
- **GIVEN** a fleet project whose health probe or telemetry query throws
- **WHEN** the monitor runs
- **THEN** the project is reported `unreachable` with the error detail, is counted separately in the summary, and is NOT reported as `healthy` with zero errors

### Requirement: Fleet operations reuse the provisioning seams and add only narrow, injected dependencies

The system SHALL access every external dependency — the Supabase Management API, the migration/deploy runner, the job store, the per-project read-only inspector, the local migration source, the clock, and logging — through narrow injected interfaces wired at the one composition root, and SHALL provide a deterministic fake for each so the full fleet flow runs in tests with no network, no live Supabase organization, and no paid API. The per-project read interface SHALL expose only purpose-specific bounded reads, not a generic SQL entry point.

#### Scenario: Full fleet flow runs against fakes
- **WHEN** the migrate sweep and the monitor are executed with fake implementations of every external dependency
- **THEN** they complete end-to-end without any real network, Supabase, or paid-API call

#### Scenario: No secret value appears in logs
- **WHEN** a full fleet run emits log output
- **THEN** no Management API token or per-project database password value appears in the emitted logs
