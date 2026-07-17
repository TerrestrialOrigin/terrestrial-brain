## ADDED Requirements

### Requirement: list_projects is bounded and reports truncation

`list_projects` SHALL accept an optional `limit` (integer, `1..MAX_QUERY_LIMIT`, default `DEFAULT_LIST_LIMIT`) threaded into the repository query, which SHALL fetch at most `limit` rows (probing `limit + 1`) rather than the whole table. When more rows exist than the limit, the response SHALL include an explicit truncation notice.

#### Scenario: A capped list_projects reports truncation
- **WHEN** more active projects exist than the requested `limit`
- **THEN** exactly `limit` projects are rendered and the response states that more exist (narrow the query)

#### Scenario: limit is schema-bounded
- **WHEN** `list_projects` is called with `limit` of 0 or above `MAX_QUERY_LIMIT`
- **THEN** the input is rejected or bounded at the schema (never an unbounded fetch)
