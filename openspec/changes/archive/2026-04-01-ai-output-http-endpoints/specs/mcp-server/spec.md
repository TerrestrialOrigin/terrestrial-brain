## MODIFIED Requirements

### Requirement: Request handling

GIVEN a valid authenticated request arrives
WHEN the handler runs
THEN:
  1. Checks if the URL path matches a direct HTTP route (`/ingest-note`, `/get-pending-ai-output`, `/get-pending-ai-output-metadata`, `/fetch-ai-output-content`, `/mark-ai-output-picked-up`, `/reject-ai-output`)
  2. If matched: dispatches to the corresponding handler function
  3. If not matched: creates a `StreamableHTTPTransport`, connects the MCP server, and delegates to the transport

#### Scenario: Direct HTTP route dispatched before MCP
- **WHEN** a POST request arrives with a path ending in `/mark-ai-output-picked-up`
- **THEN** the server SHALL handle it as a direct HTTP endpoint
- **AND** SHALL NOT pass the request to the MCP transport

#### Scenario: Unknown path falls through to MCP
- **WHEN** a POST request arrives with a path not matching any direct route
- **THEN** the server SHALL delegate to the MCP transport as before

## ADDED Requirements

### Requirement: AI output HTTP route handlers

The edge function SHALL import handler functions from `tools/ai_output.ts` for the five AI output HTTP endpoints. Each handler receives the Supabase client and request parameters, performs the database operation, and returns a result. The route handler in `index.ts` wraps the result in the standard `{ success, data/message, error }` HTTP response format.

#### Scenario: Handler function reuse
- **WHEN** the `/get-pending-ai-output` HTTP route receives a request
- **THEN** it SHALL call the same handler function that was previously used by the MCP tool
- **AND** the database query SHALL be identical
