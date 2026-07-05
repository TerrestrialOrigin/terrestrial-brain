# Delta: mcp-server — header-based-auth

> Note: the existing `openspec/specs/mcp-server.md` uses prose-style scenarios without
> `### Requirement:` blocks, so the auth behavior changes land here as ADDED requirements
> that supersede the prose "Authentication" section. At archive time, the prose
> Authentication scenarios should be replaced by these requirements.

## ADDED Requirements

### Requirement: Constant-time access-key verification
The server SHALL verify the provided access key against `MCP_ACCESS_KEY` using a constant-time comparison (SHA-256 digest of both values, compared with a branch-free byte fold). The comparison SHALL NOT short-circuit on the first differing character and SHALL NOT leak the expected key's length.

#### Scenario: Correct key accepted
- **WHEN** a request arrives whose provided key exactly matches `MCP_ACCESS_KEY`
- **THEN** the request is processed normally

#### Scenario: Wrong key rejected
- **WHEN** a request arrives whose provided key differs from `MCP_ACCESS_KEY` (any difference — prefix match, wrong length, empty)
- **THEN** the server returns HTTP 401 `{"error": "Invalid or missing access key"}`

### Requirement: Header-primary authentication with deprecated query-param fallback
The server SHALL read the access key from the `x-brain-key` request header as the primary mechanism. When the header is absent, the server SHALL fall back to the `?key=` query parameter. The query-param mechanism SHALL be documented as deprecated (retained only for MCP clients that cannot set custom headers). When both are present, the header SHALL take precedence.

#### Scenario: Header authentication accepted
- **WHEN** a request carries `x-brain-key: <valid key>` and no `?key=` parameter
- **THEN** the request is authenticated

#### Scenario: Query-param fallback still accepted
- **WHEN** a request carries `?key=<valid key>` and no `x-brain-key` header
- **THEN** the request is authenticated

#### Scenario: Header wins over query param
- **WHEN** a request carries a valid `x-brain-key` header and an invalid `?key=` parameter
- **THEN** the request is authenticated (header value is the one compared)

#### Scenario: Invalid header with valid query param rejected
- **WHEN** a request carries an invalid `x-brain-key` header and a valid `?key=` parameter
- **THEN** the server returns HTTP 401 (the header, being present, is the value compared)

#### Scenario: Missing credentials rejected
- **WHEN** a request carries neither an `x-brain-key` header nor a `?key=` parameter
- **THEN** the server returns HTTP 401 `{"error": "Invalid or missing access key"}`
