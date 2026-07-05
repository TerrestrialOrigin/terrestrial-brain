# query-error-surfacing Specification

## Purpose
TBD - created by archiving change fail-fast-env-and-errors. Update Purpose after archive.
## Requirements
### Requirement: Failed sub-queries render an explicit unavailable marker

Composite-query handlers (`get_project_summary`, `get_recent_activity`) and the name-resolution blocks in the task, AI-output, and document tools SHALL check the `error` channel of every Supabase call. When a call returns a non-null `error`, the handler MUST log the error with context (`console.error`) and render an explicit `(section unavailable: <reason>)` marker in place of that section's content. A failed sub-query MUST NOT be rendered as empty-state prose (e.g. "No open tasks.").

#### Scenario: A sub-query error surfaces as an unavailable marker

- **WHEN** a sub-query inside `get_project_summary` or `get_recent_activity` returns a non-null `error`
- **THEN** the corresponding section body reads `(section unavailable: <reason>)` including the error message
- **AND** the failure is logged via `console.error`

#### Scenario: A successful empty result still renders empty-state prose

- **WHEN** a sub-query succeeds (`error` is null) and returns zero rows
- **THEN** the section renders its normal empty-state text (e.g. "No open tasks.", "No recent thoughts.")
- **AND** the unavailable marker is NOT shown

#### Scenario: Name resolution failure falls back without masking the failure

- **WHEN** a project/person name-resolution query in a tool handler returns an error
- **THEN** the error is logged
- **AND** affected rows fall back to the raw identifier rather than a blank or a silently-empty name map

### Requirement: External-API metadata failures are observable

`extractMetadata` SHALL check `response.ok` before parsing the LLM response and SHALL log a warning whenever it falls back to the `{ topics: ["uncategorized"] }` default, so a metadata-extraction failure is distinguishable in logs from a genuinely uncategorizable thought. The thought MUST still be captured (the fallback is retained; only its observability is added).

#### Scenario: LLM call fails during metadata extraction

- **WHEN** the OpenRouter metadata call returns a non-OK response or unparseable body
- **THEN** `extractMetadata` logs a warning describing the failure
- **AND** returns the `{ topics: ["uncategorized"] }` fallback so ingestion still succeeds

#### Scenario: LLM call succeeds

- **WHEN** the OpenRouter metadata call returns a valid JSON body
- **THEN** the parsed metadata is returned and no fallback warning is logged
