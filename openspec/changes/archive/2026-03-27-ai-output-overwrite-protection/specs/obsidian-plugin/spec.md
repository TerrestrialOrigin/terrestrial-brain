## ADDED Requirements

### Requirement: Copy path generation for conflicting AI output

The plugin SHALL provide a `generateCopyPath` function that computes an alternative file path when the original target already exists in the vault. The function takes a vault-relative file path and returns a path with a numeric suffix appended before the file extension.

#### Scenario: Basic copy name generation
- **WHEN** the original path is `projects/Plan.md` and that file exists in the vault
- **AND** `projects/Plan(2).md` does NOT exist
- **THEN** `generateCopyPath` SHALL return `projects/Plan(2).md`

#### Scenario: Incremented copy name when (2) already exists
- **WHEN** the original path is `projects/Plan.md` and that file exists
- **AND** `projects/Plan(2).md` also exists
- **AND** `projects/Plan(3).md` does NOT exist
- **THEN** `generateCopyPath` SHALL return `projects/Plan(3).md`

#### Scenario: Multiple increments
- **WHEN** the original path is `notes/Todo.md`
- **AND** `notes/Todo(2).md`, `notes/Todo(3).md`, and `notes/Todo(4).md` all exist
- **AND** `notes/Todo(5).md` does NOT exist
- **THEN** `generateCopyPath` SHALL return `notes/Todo(5).md`

#### Scenario: Root-level file (no parent directory)
- **WHEN** the original path is `README.md` and that file exists
- **AND** `README(2).md` does NOT exist
- **THEN** `generateCopyPath` SHALL return `README(2).md`

#### Scenario: Safety cap at 100 attempts
- **WHEN** the original path exists and copies `(2)` through `(101)` all exist
- **THEN** `generateCopyPath` SHALL throw an error indicating the copy limit was exhausted

#### Scenario: Copy name preserves directory
- **WHEN** the original path is `deeply/nested/folder/doc.md`
- **THEN** `generateCopyPath` SHALL return a path in the same directory (`deeply/nested/folder/doc(N).md`)
- **AND** SHALL NOT change the directory portion of the path

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
  6. Calls `mark_ai_output_picked_up` with the collected IDs
  7. Persists `syncedHashes` to disk via `saveSettings()`
  8. Shows a Notice: "{N} AI output(s) delivered to vault"

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
