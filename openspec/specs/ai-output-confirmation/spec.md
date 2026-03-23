## ADDED Requirements

### Requirement: AI output confirmation dialog

The Obsidian plugin SHALL display a confirmation dialog before writing any AI output to the vault. The dialog SHALL appear whenever `pollAIOutput()` finds one or more pending outputs, whether triggered by the automatic poll interval or the manual "Pull AI output" command.

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

#### Scenario: User accepts all outputs (two-phase fetch)
- **WHEN** the user clicks "Accept All" in the confirmation dialog
- **THEN** the plugin SHALL call `fetch_ai_output_content` to retrieve the full content for all listed output IDs
- **AND** write all returned outputs to the vault (creating parent folders as needed)
- **AND** call `mark_ai_output_picked_up` with all delivered output IDs
- **AND** store content hashes in `syncedHashes` for each written file
- **AND** show a Notice confirming delivery (e.g., "3 AI output(s) delivered to vault")

#### Scenario: User rejects all outputs
- **WHEN** the user clicks "Reject All" in the confirmation dialog
- **THEN** the plugin SHALL NOT call `fetch_ai_output_content`
- **AND** the plugin SHALL NOT write any files to the vault
- **AND** the plugin SHALL call `reject_ai_output` with all output IDs
- **AND** show a Notice confirming rejection (e.g., "3 AI output(s) rejected")

#### Scenario: Dialog is blocking
- **WHEN** the confirmation dialog is displayed
- **THEN** no other poll cycle SHALL proceed until the user dismisses the dialog
