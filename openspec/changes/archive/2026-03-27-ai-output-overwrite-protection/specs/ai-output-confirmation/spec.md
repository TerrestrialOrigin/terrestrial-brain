## MODIFIED Requirements

### Requirement: AI output confirmation dialog

The Obsidian plugin SHALL display a confirmation dialog before writing any AI output to the vault. The dialog SHALL appear whenever `pollAIOutput()` finds one or more pending outputs, whether triggered by the automatic poll interval or the manual "Pull AI output" command.

The dialog SHALL indicate per-file conflict status: whether each pending output targets an existing vault file or is a new file. For conflicting files, the dialog SHALL provide a per-file control to choose between overwriting the existing file or saving under a copy name.

#### Scenario: Dialog shown with pending outputs (metadata only)
- **WHEN** `pollAIOutput()` retrieves one or more pending AI output metadata records
- **THEN** the plugin SHALL display a modal dialog listing all pending outputs
- **AND** the dialog SHALL show the total count at the top (e.g., "3 pending AI output(s)")
- **AND** each output SHALL be listed with its full file path and human-readable file size (e.g., `projects/CarChief/plan.md — 2.3 KB`)
- **AND** the full content body SHALL NOT be fetched until the user accepts

#### Scenario: No dialog when no pending outputs (automatic poll)
- **WHEN** an automatic background poll retrieves zero pending AI outputs
- **THEN** no dialog SHALL be shown and no notice SHALL be displayed (silent)

#### Scenario: No pending outputs on manual pull
- **WHEN** the user manually triggers "Pull AI Output" and there are zero pending outputs
- **THEN** the plugin SHALL show a notice: "No pending AI output to pull"

#### Scenario: Conflict detection before dialog display
- **WHEN** `pollAIOutput()` retrieves pending AI output metadata
- **THEN** the plugin SHALL check whether each output's `file_path` already exists in the vault before constructing the confirmation dialog
- **AND** pass the conflict status for each output into the dialog

#### Scenario: Conflicting file shown with overwrite/rename control
- **WHEN** a pending output's `file_path` matches an existing vault file
- **THEN** the dialog SHALL display a conflict indicator (e.g., "overwrites existing") next to that output
- **AND** the dialog SHALL show a per-file control (dropdown or toggle) with two options: "Overwrite" and "Save as copy"
- **AND** the default selection SHALL be "Overwrite"

#### Scenario: Non-conflicting file shown with new-file indicator
- **WHEN** a pending output's `file_path` does NOT match any existing vault file
- **THEN** the dialog SHALL display a "new file" indicator next to that output
- **AND** no overwrite/rename control SHALL be shown for that output

#### Scenario: User accepts all outputs (two-phase fetch)
- **WHEN** the user clicks "Accept All" in the confirmation dialog
- **THEN** the plugin SHALL call `fetch_ai_output_content` to retrieve the full content for all listed output IDs
- **AND** write all returned outputs to the vault (creating parent folders as needed), applying per-file conflict resolutions (overwrite or save as copy)
- **AND** call `mark_ai_output_picked_up` with all delivered output IDs
- **AND** store content hashes in `syncedHashes` for each written file (using the actual written path, which may differ from `file_path` if renamed)
- **AND** show a Notice confirming delivery (e.g., "3 AI output(s) delivered to vault")

#### Scenario: User rejects all outputs
- **WHEN** the user clicks "Reject All" in the confirmation dialog
- **THEN** the plugin SHALL NOT call `fetch_ai_output_content`
- **AND** the plugin SHALL NOT write any files to the vault
- **AND** the plugin SHALL call `reject_ai_output` with all output IDs
- **AND** show a Notice confirming rejection (e.g., "3 AI output(s) rejected")

#### Scenario: User closes dialog without explicit decision (postpone)
- **WHEN** the user closes the confirmation dialog by pressing Escape, clicking X, or clicking "Postpone"
- **THEN** the plugin SHALL NOT call `reject_ai_output`
- **AND** the plugin SHALL NOT call `fetch_ai_output_content`
- **AND** the plugin SHALL NOT show any Notice
- **AND** the pending outputs SHALL remain in their current state (pending) in the database
- **AND** the outputs SHALL reappear on the next poll cycle

#### Scenario: Dialog includes Postpone button
- **WHEN** the confirmation dialog is displayed
- **THEN** the dialog SHALL show three buttons: "Reject All", "Postpone", and "Accept All"
- **AND** "Accept All" SHALL be the primary call-to-action button
- **AND** "Postpone" SHALL appear between "Reject All" and "Accept All"

#### Scenario: Dialog is blocking
- **WHEN** the confirmation dialog is displayed
- **THEN** no other poll cycle SHALL proceed until the user dismisses the dialog
