## MODIFIED Requirements

### Requirement: Thought mutability

Thoughts in the `thoughts` table SHALL support updates via the `update_thought` MCP tool in addition to creation via `capture_thought` and `ingest_note`. The `updated_at` column (auto-managed by database trigger) SHALL reflect the most recent modification time.

#### Scenario: Thought updated_at reflects edits

- **WHEN** a thought is updated via `update_thought`
- **THEN** the `updated_at` column SHALL be automatically updated by the database trigger
- **AND** the `created_at` column SHALL remain unchanged
