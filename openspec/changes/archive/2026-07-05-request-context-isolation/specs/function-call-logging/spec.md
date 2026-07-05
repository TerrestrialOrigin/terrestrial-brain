## ADDED Requirements

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
