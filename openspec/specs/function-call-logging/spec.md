# Function Call Logging

## Purpose

Record every MCP tool and HTTP endpoint invocation in a service-role-only `function_call_logs` table, capturing the function name, type, input, timestamp, client IP, and any error, without letting logging failures affect normal responses.
## Requirements
### Requirement: Function call log table exists
The system SHALL maintain a `function_call_logs` table with columns: `id` (uuid PK), `function_name` (text, not null), `function_type` (text, not null), `input` (text), `called_at` (timestamptz, not null, default now()), `error_details` (text, nullable), `ip_address` (text, nullable). RLS SHALL be enabled with service-role-only access.

#### Scenario: Table schema is correct
- **WHEN** the migration has been applied
- **THEN** the `function_call_logs` table exists with all specified columns, types, and defaults

#### Scenario: RLS prevents anonymous access
- **WHEN** an anonymous or authenticated (non-service-role) client attempts to read or write `function_call_logs`
- **THEN** the operation is denied by RLS

### Requirement: MCP tool invocations are logged
The system SHALL log every MCP tool invocation to `function_call_logs` before executing the tool handler. The log entry SHALL include the tool name as `function_name`, `'mcp'` as `function_type`, JSON-serialized input parameters as `input`, and the client IP address if available.

#### Scenario: Successful MCP tool call is logged
- **WHEN** any MCP tool (e.g., `capture_thought`, `list_projects`, `create_task`) is invoked
- **THEN** a row is inserted into `function_call_logs` with the tool name, `function_type = 'mcp'`, serialized input, timestamp, and IP address
- **AND** `error_details` is null

#### Scenario: Failed MCP tool call logs the error
- **WHEN** an MCP tool is invoked and the handler returns `isError: true`
- **THEN** a row exists in `function_call_logs` with the tool name and input
- **AND** `error_details` is updated with the error text from the response

#### Scenario: Logging failure does not affect tool response
- **WHEN** an MCP tool is invoked but the log INSERT fails (e.g., database connectivity issue)
- **THEN** the tool handler still executes and returns its normal response
- **AND** the logging failure is written to console

### Requirement: HTTP endpoint invocations are logged
The system SHALL log every HTTP endpoint invocation to `function_call_logs` before executing the handler. The log entry SHALL include the endpoint path as `function_name`, `'http'` as `function_type`, JSON-serialized request body as `input`, and the client IP address if available.

#### Scenario: Successful HTTP endpoint call is logged
- **WHEN** any HTTP endpoint (e.g., `/ingest-note`, `/get-pending-ai-output`) is invoked
- **THEN** a row is inserted into `function_call_logs` with the endpoint path, `function_type = 'http'`, serialized body, timestamp, and IP address
- **AND** `error_details` is null

#### Scenario: Failed HTTP endpoint call logs the error
- **WHEN** an HTTP endpoint is invoked and the handler returns an error response
- **THEN** a row exists in `function_call_logs` with the endpoint path and input
- **AND** `error_details` is updated with the error message

#### Scenario: Logging failure does not affect HTTP response
- **WHEN** an HTTP endpoint is invoked but the log INSERT fails
- **THEN** the handler still executes and returns its normal response
- **AND** the logging failure is written to console

### Requirement: Client IP address is extracted from request headers
The system SHALL extract the client IP address from request headers in priority order: `x-forwarded-for` (first IP), `x-real-ip`, `cf-connecting-ip`. If none are present, `ip_address` SHALL be null.

#### Scenario: IP extracted from x-forwarded-for
- **WHEN** a request includes the header `x-forwarded-for: 1.2.3.4, 5.6.7.8`
- **THEN** the log entry's `ip_address` is `1.2.3.4`

#### Scenario: IP extracted from x-real-ip fallback
- **WHEN** a request has no `x-forwarded-for` but has `x-real-ip: 1.2.3.4`
- **THEN** the log entry's `ip_address` is `1.2.3.4`

#### Scenario: No IP headers present
- **WHEN** a request has none of the recognized IP headers
- **THEN** the log entry's `ip_address` is null

### Requirement: Client IP attribution is isolated per request
The system SHALL isolate the request-scoped client IP address to the async execution of the request it belongs to, so that concurrent requests handled by the same runtime isolate never observe or record one another's IP. The request IP SHALL NOT be stored in module-level mutable state that is shared across in-flight requests.

#### Scenario: Concurrent requests log their own IPs
- **WHEN** two MCP tool requests are handled concurrently in the same isolate, one carrying `x-forwarded-for: 10.0.0.1` and the other `x-forwarded-for: 10.0.0.2`
- **THEN** the `function_call_logs` row for the first request has `ip_address = 10.0.0.1`
- **AND** the `function_call_logs` row for the second request has `ip_address = 10.0.0.2`

#### Scenario: IP still recorded for a single request
- **WHEN** an MCP tool request carrying `x-forwarded-for: 1.2.3.4` is handled with no other request in flight
- **THEN** the `function_call_logs` row for that request has `ip_address = 1.2.3.4`

### Requirement: MCP server and transport are constructed per request
The system SHALL construct a fresh MCP server and transport for each MCP request rather than connecting a single shared, module-level server instance on every request, in keeping with the MCP SDK's stateless-transport guidance. Tool registration SHALL occur within the per-request construction path so no request mutates state shared with a concurrent request.

#### Scenario: MCP requests continue to return correct results
- **WHEN** an MCP tool (e.g., `list_projects`) is invoked over the streamable HTTP transport
- **THEN** the tool executes and returns its normal result
- **AND** the invocation is logged to `function_call_logs` exactly as before

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

