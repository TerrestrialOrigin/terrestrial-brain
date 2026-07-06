## ADDED Requirements

### Requirement: Function call logs have a bounded retention window

The system SHALL provide a `purge_function_call_logs(retention_days integer)` SQL function (default 90 days) that permanently deletes `function_call_logs` rows whose `called_at` is older than the given window and returns the number of rows deleted. EXECUTE on this function SHALL be granted to `service_role` only (denied to `anon`/`authenticated`). Where `pg_cron` is available, the system SHALL schedule this purge to run on a recurring basis; where it is not, the migration SHALL still succeed and the function SHALL remain directly invokable.

#### Scenario: Purge removes only old rows
- **WHEN** `purge_function_call_logs(30)` is called and the table contains rows older than 30 days and rows newer than 30 days
- **THEN** only the rows with `called_at` older than 30 days SHALL be deleted
- **AND** the function SHALL return the count of deleted rows

#### Scenario: Purge is service-role only
- **WHEN** an `anon` or `authenticated` client attempts to execute `purge_function_call_logs`
- **THEN** the call SHALL be denied

#### Scenario: Migration succeeds without pg_cron
- **WHEN** the retention migration is applied in an environment where `pg_cron` cannot be loaded
- **THEN** the migration SHALL still complete successfully with the purge function created

### Requirement: Function call logs support time-bounded and per-function queries

The system SHALL maintain a composite index on `function_call_logs (function_name, called_at)` so retention purges and per-function history queries do not require a full-table scan.

#### Scenario: Composite index exists
- **WHEN** the migration has been applied
- **THEN** an index on `(function_name, called_at)` SHALL exist on `function_call_logs`

### Requirement: Function call log rows are integrity-constrained

The system SHALL enforce `CHECK` constraints on `function_call_logs`: `function_type` SHALL be one of `'mcp'` or `'http'`, and `function_name` SHALL be a non-empty string no longer than 100 characters.

#### Scenario: Invalid function_type is rejected
- **WHEN** a row is inserted with `function_type` not in (`'mcp'`, `'http'`)
- **THEN** the database SHALL reject the insert with a check-constraint violation

#### Scenario: Empty function_name is rejected
- **WHEN** a row is inserted with an empty `function_name`
- **THEN** the database SHALL reject the insert

### Requirement: Logged input is bounded in size

The system SHALL cap the serialized `input` stored in `function_call_logs` at a bounded length before insert. When the serialized input exceeds the cap, the logger SHALL store a truncated prefix followed by a marker indicating how many characters were dropped, so logs cannot accumulate unbounded personal content per row. Truncation SHALL NOT cause the log insert (or the tool/endpoint response) to fail.

#### Scenario: Oversized input is truncated with a marker
- **WHEN** a tool or endpoint is invoked with input whose serialized form exceeds the configured cap
- **THEN** the stored `input` SHALL be the truncated prefix plus a marker noting the number of dropped characters

#### Scenario: Normal-size input is stored unchanged
- **WHEN** the serialized input is within the cap
- **THEN** the stored `input` SHALL be the full serialized value with no marker
