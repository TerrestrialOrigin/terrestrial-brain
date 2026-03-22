## MODIFIED Requirements

### Requirement: AI notes polling

The plugin SHALL poll for pending AI output using `pollAIOutput()` instead of `pollAINotes()`. The method SHALL call `get_pending_ai_output` to retrieve pending items, write each to the vault at the item's `file_path`, store hashes in `syncedHashes`, then call `mark_ai_output_picked_up` with the collected IDs.

GIVEN the plugin is loaded and `tbEndpointUrl` is configured
WHEN the plugin starts
THEN it immediately polls for pending AI output

GIVEN the poll interval elapses
WHEN the interval callback fires
THEN the plugin polls for pending AI output

GIVEN pending AI output is returned
WHEN the plugin polls
THEN for each output:
  1. Determines the file path from `output.file_path` (no fallback — path is always explicit)
  2. Creates parent folders if they don't exist
  3. Writes the file content (overwrites if exists — AI output is authoritative)
  4. Computes the content hash using `simpleHash(stripFrontmatter(content).trim())` and stores it in `syncedHashes[filePath]`
  5. Collects the output ID
After all outputs are written:
  6. Calls `mark_ai_output_picked_up` with the collected IDs
  7. Persists `syncedHashes` to disk via `saveSettings()`
  8. Shows a Notice: "{N} AI output(s) delivered to vault"

GIVEN no pending AI output exists
WHEN the plugin polls
THEN nothing happens (silent)

#### Scenario: AI output write does not trigger re-ingestion
- **WHEN** an AI output file is written to the vault by `pollAIOutput()`
- **AND** the subsequent modify event fires and `processNote()` runs for that file
- **THEN** `processNote()` SHALL find a matching hash in `syncedHashes` and skip re-ingestion

#### Scenario: AI output hash uses same transformation as processNote
- **WHEN** `pollAIOutput()` computes the hash for a written file
- **THEN** it SHALL use `simpleHash(stripFrontmatter(content).trim())` — identical to the hash computation in `processNote()`

#### Scenario: Hashes persisted after poll completes
- **WHEN** `pollAIOutput()` finishes writing all files
- **THEN** it SHALL call `saveSettings()` once to persist all new hashes to disk

#### Scenario: AI output content participates in normal ingest
- **WHEN** an AI output file is written to the vault
- **AND** the user later edits the file (changing the hash)
- **THEN** the modified file SHALL be processed by `processNote()` normally — no exclusion tag prevents ingest

---

### Requirement: Manual AI output poll command

The plugin SHALL provide a command "Pull AI output from Terrestrial Brain" that triggers an immediate poll.

GIVEN the plugin is loaded
WHEN the user triggers "Pull AI output from Terrestrial Brain"
THEN the plugin SHALL run `pollAIOutput()` immediately

#### Scenario: Command triggers immediate poll
- **WHEN** the user invokes the "Pull AI output from Terrestrial Brain" command
- **THEN** the plugin SHALL call `pollAIOutput()` immediately regardless of the poll interval timer

---

## REMOVED Requirements

### Requirement: AI notes folder setting
**Reason:** With `ai_output`, every output has an explicit `file_path`. There is no fallback folder needed.
**Migration:** Remove `aiNotesFolderBase` from `TBPluginSettings` and the settings tab. Existing saved settings are ignored via `Object.assign` with new defaults.

---

## ADDED Requirements

### Requirement: Projects folder base setting

The plugin SHALL have a `projectsFolderBase` setting (string, default `"projects"`) in `TBPluginSettings`.

#### Scenario: Default projects folder base
- **WHEN** the plugin loads with no saved `projectsFolderBase` setting
- **THEN** `projectsFolderBase` SHALL default to `"projects"`

#### Scenario: Projects folder base configurable
- **WHEN** the user sets `projectsFolderBase` to `"Projects"` in the settings tab
- **THEN** the setting SHALL be persisted and available as `this.settings.projectsFolderBase`
