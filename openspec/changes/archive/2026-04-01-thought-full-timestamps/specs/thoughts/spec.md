## MODIFIED Requirements

### Requirement: search_thoughts returns results with full timestamps

The `search_thoughts` MCP tool SHALL format `created_at` as a full ISO 8601 string (e.g. `2026-04-01T18:10:38.666Z`), not a date-only string. The tool SHALL also display `updated_at` when present.

#### Scenario: search_thoughts shows full ISO timestamp
- **WHEN** `search_thoughts` returns results
- **THEN** each result's `Captured:` line contains a full ISO 8601 timestamp with time component
- **THEN** two thoughts captured on the same day at different times are clearly distinguishable

#### Scenario: search_thoughts shows updated_at when present
- **WHEN** `search_thoughts` returns a thought that has been updated
- **THEN** the result includes an `Updated:` line with a full ISO 8601 timestamp

### Requirement: list_thoughts returns results with full timestamps

The `list_thoughts` MCP tool SHALL format `created_at` as a full ISO 8601 string. The tool SHALL fetch and display `updated_at` when present.

#### Scenario: list_thoughts shows full ISO timestamp
- **WHEN** `list_thoughts` returns results
- **THEN** each result's date display contains a full ISO 8601 timestamp with time component

#### Scenario: list_thoughts shows updated_at when present
- **WHEN** `list_thoughts` returns a thought that has been updated
- **THEN** the result includes an `Updated:` line with a full ISO 8601 timestamp

### Requirement: get_thought_by_id returns full timestamps

The `get_thought_by_id` MCP tool SHALL format both `created_at` and `updated_at` as full ISO 8601 strings.

#### Scenario: get_thought_by_id shows full ISO timestamps
- **WHEN** `get_thought_by_id` returns a thought
- **THEN** the `Captured:` line contains a full ISO 8601 timestamp
- **THEN** if `updated_at` is present, the `Updated:` line contains a full ISO 8601 timestamp

### Requirement: match_thoughts RPC includes updated_at

The `match_thoughts` Postgres function SHALL include `updated_at` (timestamptz) in its return table and select list.

#### Scenario: match_thoughts returns updated_at
- **WHEN** the `match_thoughts` RPC is called
- **THEN** each returned row includes the `updated_at` column value from the thoughts table
