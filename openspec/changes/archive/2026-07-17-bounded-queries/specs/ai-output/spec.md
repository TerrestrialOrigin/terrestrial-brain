## ADDED Requirements

### Requirement: Pending AI-output reads are explicitly bounded

`get_pending_ai_output_metadata` SHALL accept a `max_rows` bound (default 200) and return at most that many rows via `LIMIT`, and the edge repository SHALL log a truncation warning when exactly `max_rows` rows are returned. `listPending` SHALL likewise be bounded. Truncation SHALL never rely on PostgREST's silent row cap.

#### Scenario: The metadata RPC respects max_rows
- **WHEN** more pending rows exist than `max_rows`
- **THEN** at most `max_rows` rows are returned and a possible-truncation warning is logged

#### Scenario: Pending list is bounded
- **WHEN** `listPending` runs against a large pending set
- **THEN** it fetches a bounded number of rows (not the whole table)
