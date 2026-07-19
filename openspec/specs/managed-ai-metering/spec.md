# managed-ai-metering Specification

## Purpose
TBD - created by syncing change managed-ai-metering. Update Purpose after archive.
## Requirements

> **Test tier:** every scenario below is tagged `test` (deterministic). Metering has no LLM behavior, so there is no `eval` tier. Deterministic scenarios run as unit tests (pure config/window/gate/decorator against a fake meter) and as integration tests against REAL `function_call_logs` telemetry (no mock on the metered path).

### Requirement: Managed-AI usage is bounded by a configurable monthly quota that is unlimited by default

The system SHALL enforce a per-deployment monthly limit on AI-consuming operations, configured by a `TB_AI_MONTHLY_LIMIT` environment variable parsed once at the boundary into a strictly-positive integer. An unset, empty, non-numeric, or non-positive value SHALL be treated as unlimited (no enforcement), so that a self-hosted deployment and a misconfigured value both default to unlimited rather than blocking all AI. When the limit is unlimited the system SHALL NOT query usage.

#### Scenario: An unset limit means unlimited and adds no usage query
- **GIVEN** `TB_AI_MONTHLY_LIMIT` is unset
- **WHEN** an AI-consuming operation runs
- **THEN** it is allowed without any usage query, exactly as before this capability existed

#### Scenario: A non-positive or non-numeric limit is treated as unlimited
- **GIVEN** `TB_AI_MONTHLY_LIMIT` is `0`, negative, or not a number
- **WHEN** the limit is parsed at startup
- **THEN** it resolves to unlimited, so a misconfiguration never blocks all AI

#### Scenario: A positive limit is enforced
- **GIVEN** `TB_AI_MONTHLY_LIMIT` is a positive integer N
- **WHEN** usage is evaluated
- **THEN** the deployment is limited to N AI-consuming operations in the current UTC-month window

### Requirement: Usage is counted from existing telemetry with a bounded, windowed query

The system SHALL compute usage by counting `function_call_logs` rows whose `function_name` is in the metered set, whose `called_at` is within the current UTC-month window, and whose `error_details` is null — refused and failed calls consumed no completed AI operation and SHALL NOT be counted. The count SHALL use a bounded count query that never loads the rows. The metered set SHALL be a single shared definition so that the operations counted are exactly the operations enforced. Rows outside the window, rows for non-metered functions, and errored rows SHALL NOT be counted.

#### Scenario: Only in-window metered calls are counted
- **GIVEN** `function_call_logs` contains metered-function rows in the current UTC month, metered-function rows dated to a previous month, and non-metered-function rows in the current month
- **WHEN** usage since the start of the current UTC month is counted
- **THEN** only the current-month metered-function rows are counted

#### Scenario: Errored and refused calls are not counted
- **GIVEN** the window contains one successful metered call and one metered call whose row carries `error_details` (a refusal or a failure)
- **WHEN** usage is counted
- **THEN** the count is 1

#### Scenario: The count is bounded
- **WHEN** usage is counted
- **THEN** it is obtained by a count query (no row payload is fetched), so the cost does not grow with history size

#### Scenario: An empty log counts as zero usage
- **GIVEN** a project whose `function_call_logs` has no metered rows in the window
- **WHEN** usage is counted
- **THEN** the count is zero and operations are allowed up to the limit


### Requirement: Over-quota AI operations are refused before any AI call, as a distinct user-visible state

When the deployment is at or over its monthly limit, the system SHALL refuse a metered AI-consuming operation BEFORE making any AI call, and SHALL surface a distinct quota-exceeded state that names the usage, the limit, and the reset time. An over-quota MCP tool SHALL return an error result (marked as an error, logged with zero records returned), and the over-quota `ingest-note` HTTP route SHALL return a client error status. A quota-exceeded result SHALL NEVER be presented as an empty successful read.

#### Scenario: An over-quota capture is refused before any AI call
- **GIVEN** usage has reached the limit
- **WHEN** a metered capture operation is invoked
- **THEN** it returns a quota-exceeded error, performs no embedding or extraction, and writes no thought

#### Scenario: An over-quota search returns a quota error, not an empty result
- **GIVEN** usage has reached the limit
- **WHEN** a metered search is invoked
- **THEN** it returns a distinct quota-exceeded error and NOT a "no thoughts found" empty result

#### Scenario: The boundary allows exactly the limit
- **GIVEN** a limit of N and N metered operations already recorded in the window
- **WHEN** the next metered operation's quota is checked
- **THEN** it is refused, whereas with fewer than N recorded it is allowed

#### Scenario: The over-quota HTTP ingest route returns a client-error status
- **GIVEN** usage has reached the limit
- **WHEN** the `ingest-note` route is called
- **THEN** it responds with a client-error status and a quota-exceeded message, not a success

### Requirement: Metering is best-effort cost control and fails open

The quota is a cost-control mechanism, not an authorization boundary. If the usage query fails, the system SHALL allow the operation (fail open) and SHALL log the failure, rather than blocking a legitimate operation on a transient telemetry error. Metering SHALL NOT read or expose note or thought content — only call counts and the aggregate usage/limit/reset.

#### Scenario: A usage-query failure allows the operation and is logged
- **GIVEN** the usage count query throws a transient error
- **WHEN** the quota is checked
- **THEN** the operation is allowed and the failure is logged, never silently turned into a block or a wrong empty result

#### Scenario: The quota-exceeded message carries no personal content
- **WHEN** a quota-exceeded result is produced
- **THEN** it contains only the aggregate usage, limit, and reset time — no note or thought content

### Requirement: A refusal does not reduce the remaining allowance

A call refused over-quota SHALL NOT reduce the allowance available to later calls: its log row ends with `error_details` set and is excluded from subsequent counts. The gate retains the pre-count convention (the in-flight call's own row is included; `used <= limit` permits exactly `limit` completed operations per window), and the residual over-refusal window under concurrent at-limit calls SHALL be documented on the gate as an accepted tolerance of best-effort cost control.

#### Scenario: Retry after a refusal within quota succeeds
- **GIVEN** a limit of 2 with 1 successful metered call and 1 refused call recorded this window
- **WHEN** a new metered call checks the gate
- **THEN** `used` is 2 (the success plus the in-flight call) and the call is allowed

### Requirement: The enforcement clock is injectable

Every quota enforcement point SHALL take its clock through a seam: `withAiQuota` accepts an injectable `now` (defaulting to `Date.now`), and the HTTP route dependencies carry a `now` function supplied by the composition root. Month-boundary behavior MUST be unit-testable at a chosen instant without freezing the global clock.

#### Scenario: Month rollover re-admits calls
- **GIVEN** a frozen clock at the end of a month in which the quota is exhausted
- **WHEN** the same decorator runs with the clock advanced past the UTC month boundary
- **THEN** the gate counts the new (empty) window and the call is allowed
