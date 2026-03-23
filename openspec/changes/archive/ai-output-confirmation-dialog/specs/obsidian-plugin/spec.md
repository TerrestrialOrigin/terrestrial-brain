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
  1. Display a confirmation dialog (modal) listing all pending outputs with file path and character count
  2. Wait for the user to click "Accept All" or "Reject All"

GIVEN the user clicks "Accept All"
THEN the plugin SHALL for each output:
  1. Creates parent folders if they don't exist
  2. Writes the file content (overwrites if exists — AI output is authoritative)
  3. Computes the content hash using `simpleHash(stripFrontmatter(content).trim())` and stores it in `syncedHashes[filePath]`
  4. Collects the output ID
After all outputs are written:
  5. Calls `mark_ai_output_picked_up` with the collected IDs
  6. Persists `syncedHashes` to disk via `saveSettings()`
  7. Shows a Notice: "{N} AI output(s) delivered to vault"

GIVEN the user clicks "Reject All"
THEN the plugin SHALL handle rejection:
  1. Call `reject_ai_output` via MCP with all pending output IDs
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
- **THEN** the rejected outputs SHALL NOT appear in the pending list (they are filtered out by `get_pending_ai_output`)
