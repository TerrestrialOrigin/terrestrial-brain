## MODIFIED Requirements

### Requirement: MCP communication

The plugin SHALL communicate with the MCP endpoint through a `TerrestrialBrainApiClient` abstraction. The default `HttpTerrestrialBrainClient` implementation SHALL POST JSON to `{endpointUrl}/{endpointName}` (query string preserved), send the access key as an `x-tb-key` request header (never in the URL), parse the JSON response, throw an error carrying a bounded/sanitized `response.error` when `response.success` is false, and otherwise return the parsed response object. Note ingestion SHALL reuse the same request path (`ingestNote` is a thin wrapper over the shared call), eliminating a duplicated HTTP implementation.

#### Scenario: Successful HTTP call returns response object
- **WHEN** the client POSTs to an endpoint and the server responds `{ success: true, ... }`
- **THEN** the client SHALL return the full parsed response object

#### Scenario: Endpoint called with body
- **WHEN** the client is called with a body payload
- **THEN** it SHALL send the body as a JSON POST and return the full response object

#### Scenario: HTTP error response
- **WHEN** the server responds with a non-2xx status
- **THEN** the client SHALL throw an error containing the (bounded, sanitized) response body

#### Scenario: Failure response throws
- **WHEN** the server responds `{ success: false, error }`
- **THEN** the client SHALL throw an error carrying the sanitized `error` text

#### Scenario: Note ingestion shares the client request path
- **WHEN** the plugin ingests a note
- **THEN** it SHALL call the client's `ingestNote(content, title, noteId)`
- **AND** that call SHALL go through the same shared request/header/error handling as other endpoint calls (no separate duplicated HTTP code)

### Requirement: Dedicated access-key setting sent as request header

The plugin SHALL store the access key in a dedicated `accessKey` setting (default `""`), separate from the endpoint URL. Every HTTP request the plugin makes to the brain (`callHTTP`, `callIngestNote`) SHALL send the key in an `x-tb-key` request header when `accessKey` is non-empty, and SHALL NOT append the key to the request URL.

#### Scenario: Header sent on generic HTTP calls
- **WHEN** `callHTTP` runs with `accessKey` set to `"secret123"`
- **THEN** the outgoing request includes the header `x-tb-key: secret123`
- **AND** the request URL contains no `key` query parameter

#### Scenario: Header sent on note ingestion
- **WHEN** `callIngestNote` runs with `accessKey` set
- **THEN** the outgoing request includes the `x-tb-key` header with that value

#### Scenario: Empty key omits the header
- **WHEN** `accessKey` is `""`
- **THEN** no `x-tb-key` header is added (the server responds 401 and the existing error path surfaces it)
