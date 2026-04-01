## MODIFIED Requirements

### Requirement: AI output polling

The plugin SHALL poll for pending AI output on startup and at each poll interval.

GIVEN the plugin is loaded and `tbEndpointUrl` is configured
WHEN the plugin starts
THEN it SHALL immediately poll for pending AI output

GIVEN the poll interval elapses
WHEN the interval callback fires
THEN the plugin SHALL poll for pending AI output

GIVEN pending AI output is returned
WHEN the plugin polls
THEN the plugin SHALL:
  1. Check which pending outputs target existing vault files (conflict detection)
  2. Display a confirmation dialog (modal) listing all pending outputs with file path, character count, and conflict status
  3. Wait for the user to click "Accept All" or "Reject All"

GIVEN the user clicks "Accept All"
THEN the plugin SHALL for each output:
  1. Creates parent folders if they don't exist
  2. If the user chose "Save as copy" for this output, computes the copy path via `generateCopyPath` and writes to the copy path instead
  3. Otherwise writes the file content to the original path (overwrites if exists)
  4. Computes the content hash using `simpleHash(stripFrontmatter(content).trim())` and stores it in `syncedHashes[actualWrittenPath]`
  5. Collects the output ID
After all outputs are written:
  6. Calls the `/mark-ai-output-picked-up` HTTP endpoint with the collected IDs
  7. Persists `syncedHashes` to disk via `saveSettings()`
  8. Shows a Notice: "{N} AI output(s) delivered to vault"

GIVEN the user clicks "Reject All"
THEN the plugin SHALL handle rejection:
  1. Call the `/reject-ai-output` HTTP endpoint with all pending output IDs
  2. Show a Notice: "{N} AI output(s) rejected"
  3. NOT write any files to the vault

GIVEN no pending AI output exists
WHEN the plugin polls
THEN the plugin SHALL take no action (silent)

#### Scenario: AI output write does not trigger re-ingestion
- **WHEN** an AI output file is written to the vault by `pollAIOutput()` after user acceptance
- **AND** the subsequent modify event fires and `processNote()` runs for that file
- **THEN** `processNote()` SHALL find a matching hash in `syncedHashes` and skip re-ingestion

#### Scenario: AI output hash uses same transformation as processNote
- **WHEN** `pollAIOutput()` computes the hash for a written file
- **THEN** it SHALL use `simpleHash(stripFrontmatter(content).trim())` — identical to the hash computation in `processNote()`

#### Scenario: Hashes persisted after poll completes
- **WHEN** `pollAIOutput()` finishes writing all files after user acceptance
- **THEN** it SHALL call `saveSettings()` once to persist all new hashes to disk

#### Scenario: AI output content participates in normal ingest
- **WHEN** an AI output file is written to the vault
- **AND** the user later edits the file (changing the hash)
- **THEN** the modified file SHALL be processed by `processNote()` normally — no exclusion tag prevents ingest

#### Scenario: Rejection does not write files
- **WHEN** the user rejects pending AI output via the confirmation dialog
- **THEN** no files SHALL be written to the vault
- **AND** no hashes SHALL be added to `syncedHashes`

#### Scenario: Rejected outputs do not reappear
- **WHEN** the user rejects pending AI output
- **AND** the next poll cycle runs
- **THEN** the rejected outputs SHALL NOT appear in the pending list

#### Scenario: Renamed file hash stored under actual path
- **WHEN** a user chose "Save as copy" for a conflicting AI output
- **AND** the file is written to `path/File(2).md` instead of `path/File.md`
- **THEN** `syncedHashes` SHALL contain an entry for `path/File(2).md`
- **AND** SHALL NOT contain a new entry for `path/File.md` from this delivery

#### Scenario: Copy path generation failure skips file
- **WHEN** `generateCopyPath` throws (e.g., exhausted 100 attempts)
- **THEN** that specific file SHALL be skipped
- **AND** a Notice SHALL be shown for the error
- **AND** remaining files SHALL still be delivered

#### Scenario: Conflict detection runs before dialog
- **WHEN** `pollAIOutput()` retrieves pending AI output metadata
- **THEN** the plugin SHALL call `this.app.vault.adapter.exists(path)` for each output's `file_path` before constructing the confirmation dialog

---

### Requirement: MCP communication

GIVEN the plugin needs to call a direct HTTP endpoint on the edge function
WHEN `callHTTP(endpointName, body?)` is called
THEN the plugin:
  1. Constructs the URL using `buildEndpointUrl(tbEndpointUrl, endpointName)`
  2. Sends a POST request with `Content-Type: application/json` header
  3. If `body` is provided, serializes it as JSON in the request body
  4. Parses the JSON response
  5. If `response.success` is false, throws an error with `response.error`
  6. Returns the parsed response object

The `callMCP` method SHALL be removed since no operations use MCP JSON-RPC from the plugin.

#### Scenario: Successful HTTP call with data
- **WHEN** `callHTTP("get-pending-ai-output-metadata")` is called
- **AND** the endpoint returns `{ success: true, data: [...] }`
- **THEN** `callHTTP` SHALL return the full response object

#### Scenario: Successful HTTP call with message
- **WHEN** `callHTTP("mark-ai-output-picked-up", { ids: [...] })` is called
- **AND** the endpoint returns `{ success: true, message: "..." }`
- **THEN** `callHTTP` SHALL return the full response object

#### Scenario: HTTP error response
- **WHEN** `callHTTP` receives a non-2xx HTTP status
- **THEN** it SHALL throw an error with the response body

#### Scenario: Endpoint returns success: false
- **WHEN** `callHTTP` receives `{ success: false, error: "..." }`
- **THEN** it SHALL throw an error with the error message

## ADDED Requirements

### Requirement: Generic endpoint URL construction

The plugin SHALL provide a `buildEndpointUrl(tbEndpointUrl, endpointName)` function that constructs a direct HTTP endpoint URL from the base MCP endpoint URL. The function inserts `/<endpointName>` before the query string. This replaces the specific `buildIngestNoteUrl` function.

#### Scenario: URL with query string
- **WHEN** `buildEndpointUrl("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc", "mark-ai-output-picked-up")` is called
- **THEN** it SHALL return `"https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp/mark-ai-output-picked-up?key=abc"`

#### Scenario: URL without query string
- **WHEN** `buildEndpointUrl("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp", "ingest-note")` is called
- **THEN** it SHALL return `"https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp/ingest-note"`

#### Scenario: Backwards compatibility with ingest-note
- **WHEN** `callIngestNote` calls `buildEndpointUrl(url, "ingest-note")`
- **THEN** it SHALL produce the same URL as the old `buildIngestNoteUrl` function
