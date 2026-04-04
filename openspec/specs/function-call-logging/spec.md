## ADDED Requirements

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

### Requirement: Ingest-thought function invocations are logged
The system SHALL log each Slack message processing in the `ingest-thought` Edge Function to `function_call_logs` with `function_name = 'ingest-thought'`, `function_type = 'http'`, and the message content as input.

#### Scenario: Slack message processing is logged
- **WHEN** the `ingest-thought` function processes a Slack message
- **THEN** a row is inserted into `function_call_logs` with `function_name = 'ingest-thought'` and the message text as input

#### Scenario: Failed Slack processing logs the error
- **WHEN** the `ingest-thought` function encounters an error during processing
- **THEN** `error_details` is updated with the error message

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
