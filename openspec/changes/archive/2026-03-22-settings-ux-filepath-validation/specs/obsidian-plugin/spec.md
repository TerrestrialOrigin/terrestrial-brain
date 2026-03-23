## MODIFIED Requirements

### Requirement: Settings

The plugin SHALL expose the following settings, persisted via `this.saveData()`:

| Setting | Default | Description |
|---------|---------|-------------|
| `tbEndpointUrl` | `""` | Full MCP endpoint URL (including ?key= param) |
| `excludeTag` | `"terrestrialBrainExclude"` | Notes with this tag (inline or frontmatter) are never synced |
| `syncDelayMinutes` | `5` | Wait time after last edit before auto-syncing, in minutes. Minimum: 1 minute |
| `pollIntervalMinutes` | `10` | Interval for checking for new AI output, in minutes. Minimum: 1 minute |
| `projectsFolderBase` | `"projects"` | Base folder for project files in the vault |

The plugin SHALL convert minute values to milliseconds internally (`value * 60000`) when scheduling timers.

#### Scenario: Settings stored in minutes
- **WHEN** a user sets "Sync delay" to `3` in the settings UI
- **THEN** the plugin SHALL store `syncDelayMinutes: 3` in persisted data
- **AND** use `180000` milliseconds when scheduling the per-file debounce timer

#### Scenario: Poll interval stored in minutes
- **WHEN** a user sets "AI output poll interval" to `15` in the settings UI
- **THEN** the plugin SHALL store `pollIntervalMinutes: 15` in persisted data
- **AND** use `900000` milliseconds when scheduling the poll interval timer

#### Scenario: Minimum value enforcement
- **WHEN** a user enters a value less than 1 for sync delay or poll interval
- **THEN** the plugin SHALL NOT update the setting (ignore the invalid input)

#### Scenario: Migration from millisecond settings
- **WHEN** the plugin loads and finds `debounceMs` or `pollIntervalMs` in persisted data (from a previous version)
- **THEN** the plugin SHALL convert those values to minutes (divide by 60000, round to nearest integer)
- **AND** store the converted values as `syncDelayMinutes` and `pollIntervalMinutes`

### Requirement: Plugin lifecycle

GIVEN Obsidian loads the plugin
WHEN `onload()` runs
THEN:
  1. Loads settings and syncedHashes from disk
  2. Registers file modify event handler
  3. Registers commands: sync current note, sync vault, poll AI output
  4. Adds ribbon icon (brain icon) with context menu
  5. Adds settings tab
  6. Runs initial AI output poll
  7. Starts poll interval timer

GIVEN Obsidian unloads the plugin
WHEN `onunload()` runs
THEN all pending debounce timers are cleared

#### Scenario: Ribbon icon shows context menu
- **WHEN** the user clicks the brain ribbon icon
- **THEN** the plugin SHALL display a context menu with exactly two items:
  1. "Sync note to Terrestrial Brain"
  2. "Pull AI Output from Terrestrial Brain"

#### Scenario: Context menu sync action
- **WHEN** the user selects "Sync note to Terrestrial Brain" from the context menu
- **THEN** the plugin SHALL cancel any pending debounce timer for the active file
- **AND** call `processNote` with `force: true` for the active file
- **AND** show a Notice if no file is active

#### Scenario: Context menu pull action
- **WHEN** the user selects "Pull AI Output from Terrestrial Brain" from the context menu
- **THEN** the plugin SHALL run `pollAIOutput()` immediately

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
  3. Calls `ingest_note` via MCP with content, title (basename), and note_id (vault-relative path)
  4. Stores the new content hash in syncedHashes
  5. Persists syncedHashes to disk

#### Scenario: Timer uses minutes-to-ms conversion
- **WHEN** the plugin schedules a sync timer
- **THEN** the timer delay SHALL be `syncDelayMinutes * 60000` milliseconds
