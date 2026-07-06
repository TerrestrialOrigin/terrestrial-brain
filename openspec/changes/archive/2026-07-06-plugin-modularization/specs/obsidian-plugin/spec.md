## ADDED Requirements

### Requirement: AI-output responses validated at the client boundary

The plugin SHALL validate the shape of AI-output poll responses at the API-client boundary before using them, rather than casting untrusted server data to the expected type. A response whose `data` payload is not the expected array of objects SHALL be treated as an error (surfaced in a Notice on a manual pull, logged on a background poll) and SHALL NOT drive any vault write.

#### Scenario: Well-formed metadata response is accepted
- **WHEN** the plugin polls `get-pending-ai-output-metadata` and the server returns `data` as an array of objects each having `id`, `title`, `file_path`, `content_size`, and `created_at`
- **THEN** the plugin SHALL proceed with conflict detection and the confirmation dialog as normal

#### Scenario: Malformed metadata response is rejected, not cast
- **WHEN** the plugin polls `get-pending-ai-output-metadata` and the server returns `data` that is not an array of the expected object shape (e.g. a string, an object, or an array of non-objects)
- **THEN** the plugin SHALL raise an error instead of casting the value
- **AND** SHALL NOT open the confirmation dialog or write any file
- **AND** SHALL surface the error in a Notice when the poll was manual, or log it when the poll was automatic

#### Scenario: Malformed content response is rejected, not cast
- **WHEN** the plugin fetches `fetch-ai-output-content` after user acceptance and the server returns `data` that is not an array of objects each having `id` and `content`
- **THEN** the plugin SHALL raise an error instead of casting the value
- **AND** SHALL NOT write any file for that delivery

### Requirement: Obsolete settings keys are dropped on load

On load the plugin SHALL remove obsolete settings keys — including the retired `projectsFolderBase` field and the legacy `debounceMs`/`pollIntervalMs` fields — from the in-memory settings object, and SHALL persist the cleaned settings once when any obsolete key was present. Removal SHALL NOT affect any live setting or stored `syncedHashes`.

#### Scenario: Retired projectsFolderBase key is removed
- **WHEN** the plugin loads persisted settings that contain a `projectsFolderBase` field
- **THEN** the in-memory settings object SHALL NOT contain `projectsFolderBase`
- **AND** the cleaned settings SHALL be persisted once
- **AND** all other settings values and `syncedHashes` SHALL be preserved

#### Scenario: No persist when nothing obsolete is present
- **WHEN** the plugin loads persisted settings that contain no obsolete keys
- **THEN** the plugin SHALL NOT perform an extra persistence write on account of key cleanup

## MODIFIED Requirements

### Requirement: MCP communication

The plugin SHALL communicate with the MCP endpoint through a `TerrestrialBrainApiClient` abstraction. The default `HttpTerrestrialBrainClient` implementation SHALL POST JSON to `{endpointUrl}/{endpointName}` (query string preserved), send the access key as an `x-brain-key` request header (never in the URL), parse the JSON response, throw an error carrying a bounded/sanitized `response.error` when `response.success` is false, and otherwise return the parsed response object. Note ingestion SHALL reuse the same request path (`ingestNote` is a thin wrapper over the shared call), eliminating a duplicated HTTP implementation.

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
