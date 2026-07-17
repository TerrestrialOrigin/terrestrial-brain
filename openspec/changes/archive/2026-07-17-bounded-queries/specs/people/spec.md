## ADDED Requirements

### Requirement: list_people is bounded and reports truncation

`list_people` SHALL accept an optional `limit` (integer, `1..MAX_QUERY_LIMIT`, default `DEFAULT_LIST_LIMIT`) threaded into the repository query, which SHALL fetch at most `limit` rows (probing `limit + 1`). When more rows exist, the response SHALL include an explicit truncation notice.

#### Scenario: A capped list_people reports truncation
- **WHEN** more people exist than the requested `limit`
- **THEN** exactly `limit` people are rendered and the response states that more exist
