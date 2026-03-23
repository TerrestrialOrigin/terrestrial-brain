## CHANGED Requirements

### Requirement: AI output confirmation dialog — dialog dismissal behavior

#### Scenario: User closes dialog without explicit decision (CHANGED)
- **WHEN** the user closes the confirmation dialog by pressing Escape, clicking X, or clicking "Postpone"
- **THEN** the plugin SHALL NOT call `reject_ai_output`
- **AND** the plugin SHALL NOT call `fetch_ai_output_content`
- **AND** the plugin SHALL NOT show any Notice
- **AND** the pending outputs SHALL remain in their current state (pending) in the database
- **AND** the outputs SHALL reappear on the next poll cycle

#### Scenario: Dialog includes Postpone button (NEW)
- **WHEN** the confirmation dialog is displayed
- **THEN** the dialog SHALL show three buttons: "Reject All", "Postpone", and "Accept All"
- **AND** "Accept All" SHALL be the primary call-to-action button
- **AND** "Postpone" SHALL appear between "Reject All" and "Accept All"

#### Scenario: User accepts all outputs (UNCHANGED)
- **WHEN** the user clicks "Accept All" in the confirmation dialog
- **THEN** behavior is unchanged (two-phase fetch and delivery)

#### Scenario: User rejects all outputs (UNCHANGED)
- **WHEN** the user clicks "Reject All" in the confirmation dialog
- **THEN** behavior is unchanged (reject without fetching content)
