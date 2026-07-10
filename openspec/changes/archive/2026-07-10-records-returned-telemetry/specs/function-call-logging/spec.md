## MODIFIED Requirements

### Requirement: Function call log table exists
The system SHALL maintain a `function_call_logs` table with columns: `id` (uuid PK), `function_name` (text, not null), `function_type` (text, not null), `input` (text), `called_at` (timestamptz, not null, default now()), `error_details` (text, nullable), `ip_address` (text, nullable), `records_returned` (integer, nullable), `response_characters` (integer, nullable), and `returned_ids` (jsonb, nullable). RLS SHALL be enabled with service-role-only access.

#### Scenario: Table schema is correct
- **WHEN** the migration has been applied
- **THEN** the `function_call_logs` table exists with all specified columns, types, and defaults
- **AND** `returned_ids` is a nullable `jsonb` column

#### Scenario: RLS prevents anonymous access
- **WHEN** an anonymous or authenticated (non-service-role) client attempts to read or write `function_call_logs`
- **THEN** the operation is denied by RLS

## ADDED Requirements

### Requirement: Result metrics reflect the true returned-row count
The system SHALL record in `records_returned` the number of database rows a tool call returned, not the number of MCP content blocks in the response. Row-returning read handlers SHALL supply the real count (including `0` for an empty result); handlers that do not supply a count SHALL fall back to the single-record default of `1`. On any error path — a handler that throws or returns `isError: true` — `records_returned` SHALL be recorded as `0`.

#### Scenario: Search returning N rows logs N
- **WHEN** a `search_thoughts` (or `list_thoughts`) call returns N thoughts
- **THEN** the `function_call_logs` row for that call has `records_returned = N`

#### Scenario: Empty read logs zero
- **WHEN** a `search_thoughts` (or `list_thoughts`) call returns no matching thoughts
- **THEN** the `function_call_logs` row for that call has `records_returned = 0`

#### Scenario: Errored call logs zero returned rows
- **WHEN** a wrapped tool handler throws, or returns an `isError: true` envelope
- **THEN** the `function_call_logs` row has `records_returned = 0`
- **AND** `error_details` is set to the error text

#### Scenario: Single-record read logs one
- **WHEN** `get_thought_by_id` returns exactly one thought
- **THEN** the `function_call_logs` row has `records_returned = 1`

### Requirement: Thought-retrieval calls log their returned ids
The system SHALL record in the `returned_ids` column the ids of the thoughts a retrieval call returned, for `search_thoughts`, `list_thoughts`, and `get_thought_by_id`. The stored value SHALL contain ids only — never thought or note content — and SHALL be bounded by the query limit. For calls that return no rows, and for tool calls that are not thought-retrieval reads, `returned_ids` SHALL be null.

#### Scenario: Search logs the returned thought ids
- **WHEN** a `search_thoughts` call returns thoughts with ids `[a, b, c]`
- **THEN** the `function_call_logs` row's `returned_ids` is the JSON array `[a, b, c]`
- **AND** the stored value contains no thought content

#### Scenario: get_thought_by_id logs the single returned id
- **WHEN** `get_thought_by_id` returns the thought with id `x`
- **THEN** the `function_call_logs` row's `returned_ids` is `[x]`

#### Scenario: Empty or non-retrieval calls carry no returned ids
- **WHEN** a retrieval call returns no rows, or a non-retrieval tool (e.g. `create_task`) is invoked
- **THEN** the `function_call_logs` row's `returned_ids` is null
