## MODIFIED Requirements

### Requirement: Direct HTTP endpoint authentication

All direct HTTP endpoints SHALL use the same authentication mechanism: the `x-tb-key` header or `?key=` query parameter checked against the `MCP_ACCESS_KEY` environment variable. This is the same auth used by the MCP transport and the existing `/ingest-note` endpoint.

#### Scenario: Valid auth via header
- **WHEN** a client sends a request to any direct endpoint with `x-tb-key` header matching `MCP_ACCESS_KEY`
- **THEN** the request SHALL be processed

#### Scenario: Valid auth via query param
- **WHEN** a client sends a request to any direct endpoint with `?key=` matching `MCP_ACCESS_KEY`
- **THEN** the request SHALL be processed

#### Scenario: Missing or invalid auth
- **WHEN** a client sends a request without valid auth
- **THEN** the endpoint SHALL return HTTP 401 with `{ error: "Invalid or missing access key" }`
