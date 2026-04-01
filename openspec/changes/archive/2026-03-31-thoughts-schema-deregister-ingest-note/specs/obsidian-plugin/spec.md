## MODIFIED Requirements

### Requirement: Auto-sync on edit

GIVEN the plugin is loaded and `tbEndpointUrl` is configured
WHEN a markdown file is modified in the vault
THEN the plugin starts (or resets) a per-file debounce timer using the sync delay converted to milliseconds (`syncDelayMinutes * 60000`)

GIVEN the debounce timer fires for a file
AND the file is not excluded
AND the file's content hash differs from the last synced hash
WHEN the timer callback runs
THEN the plugin:
  1. Reads the file content
  2. Strips YAML frontmatter
  3. Calls the `/ingest-note` HTTP endpoint directly with `{ content, title, note_id }` as a plain JSON POST (NOT via MCP `tools/call`)
  4. Stores the new content hash in syncedHashes
  5. Persists syncedHashes to disk

#### Scenario: Plugin calls ingest-note via direct HTTP POST
- **WHEN** the plugin syncs a note to Terrestrial Brain
- **THEN** it SHALL send a POST request to the `/ingest-note` path on the server (derived from `tbEndpointUrl`) with body `{ "content": "...", "title": "...", "note_id": "..." }` and `Content-Type: application/json`
- **AND** it SHALL NOT use the MCP JSON-RPC `tools/call` protocol for this call

#### Scenario: Plugin reads plain JSON response from ingest-note
- **WHEN** the `/ingest-note` endpoint returns a response
- **THEN** the plugin SHALL parse it as plain JSON and extract the `message` field for the success notice
- **AND** if `success` is false, it SHALL throw an error with the `error` field

#### Scenario: Other MCP calls are unaffected
- **WHEN** the plugin calls other tools (e.g., `get_pending_ai_output_metadata`, `mark_ai_output_picked_up`, `reject_ai_output`, `fetch_ai_output_content`)
- **THEN** it SHALL continue using `callMCP()` with the JSON-RPC protocol as before

### Requirement: MCP communication

GIVEN the plugin needs to call an MCP tool (any tool EXCEPT ingest_note)
WHEN `callMCP(toolName, args)` is called
THEN the plugin:
  1. Sends a JSON-RPC 2.0 POST to `tbEndpointUrl`
  2. Handles two response formats:
     a. `application/json` — parses result directly
     b. `text/event-stream` — extracts data lines, parses each as JSON, returns first valid result
  3. Returns the text content from the first content block
  4. Throws on HTTP errors, JSON-RPC errors, or tool errors (isError)

#### Scenario: callMCP is not used for ingest_note
- **WHEN** the plugin needs to ingest a note
- **THEN** it SHALL use `callIngestNote()` instead of `callMCP("ingest_note", ...)`

## ADDED Requirements

### Requirement: Direct HTTP call for note ingestion

The plugin SHALL provide a `callIngestNote(content, title, noteId)` method that calls the `/ingest-note` HTTP endpoint directly, bypassing the MCP JSON-RPC protocol.

#### Scenario: callIngestNote constructs URL from tbEndpointUrl
- **WHEN** `callIngestNote` is called
- **AND** `tbEndpointUrl` is `https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc`
- **THEN** the request SHALL be sent to `https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp/ingest-note?key=abc`

#### Scenario: callIngestNote sends plain JSON body
- **WHEN** `callIngestNote("note content", "My Note", "folder/My Note.md")` is called
- **THEN** the request body SHALL be `{ "content": "note content", "title": "My Note", "note_id": "folder/My Note.md" }`
- **AND** the Content-Type header SHALL be `application/json`

#### Scenario: callIngestNote authenticates with x-brain-key
- **WHEN** `callIngestNote` sends the request
- **THEN** the request SHALL include the `x-brain-key` header with the key extracted from `tbEndpointUrl`, OR use the `?key=` query parameter in the constructed URL

#### Scenario: callIngestNote returns message on success
- **WHEN** the `/ingest-note` endpoint returns `{ "success": true, "message": "Synced ..." }`
- **THEN** `callIngestNote` SHALL return the `message` string

#### Scenario: callIngestNote throws on failure
- **WHEN** the `/ingest-note` endpoint returns `{ "success": false, "error": "..." }`
- **THEN** `callIngestNote` SHALL throw an Error with the `error` string as the message

#### Scenario: callIngestNote throws on HTTP error
- **WHEN** the HTTP response status is not 2xx
- **THEN** `callIngestNote` SHALL throw an Error with the status code and response body
