# managed-ai-metering — Delta (quota-metering-accuracy)

## MODIFIED Requirements

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

## ADDED Requirements

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
