## ADDED Requirements

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

The system SHALL compute usage by counting `function_call_logs` rows whose `function_name` is in the metered set and whose `called_at` is within the current UTC-month window, using a bounded count query that never loads the rows. The metered set SHALL be a single shared definition so that the operations counted are exactly the operations enforced. Rows outside the window, and rows for non-metered functions, SHALL NOT be counted.

#### Scenario: Only in-window metered calls are counted
- **GIVEN** `function_call_logs` contains metered-function rows in the current UTC month, metered-function rows dated to a previous month, and non-metered-function rows in the current month
- **WHEN** usage since the start of the current UTC month is counted
- **THEN** only the current-month metered-function rows are counted

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
