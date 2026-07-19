# query-error-surfacing — Delta (error-surfacing-sweep)

## ADDED Requirements

### Requirement: Entity-detail sub-lookup failures render an explicit unavailable marker

`get_project`, `get_person`, and `list_projects` SHALL check the `error` channel of every auxiliary lookup (`findName`, `listChildrenBasic`, `countOpenByProject`, `countOpenByAssignee`, `listChildParentIds`). When an auxiliary lookup fails, the handler MUST log the error with a context label via `console.error` and MUST render an explicit unavailable marker in place of that value. A failed count MUST NOT render as `0`; a failed child/parent lookup MUST NOT render as a silently-absent line.

#### Scenario: Failed open-task count in get_project

- **WHEN** `countOpenByProject` returns a non-null `error` inside `get_project`
- **THEN** the output line reads `Open tasks: ? (lookup failed)` instead of `Open tasks: 0`
- **AND** the failure is logged via `console.error`

#### Scenario: Failed open-task count in get_person

- **WHEN** `countOpenByAssignee` returns a non-null `error` inside `get_person`
- **THEN** the output line reads `Open tasks assigned: ? (lookup failed)`
- **AND** the failure is logged via `console.error`

#### Scenario: Failed parent-name or children lookup in get_project

- **WHEN** `findName` or `listChildrenBasic` returns a non-null `error` inside `get_project`
- **THEN** the corresponding line renders `? (lookup failed)` for the affected value
- **AND** the entity's own fields are still returned (the tool does not fail wholesale)

#### Scenario: Failed child-count lookup in list_projects

- **WHEN** `listChildParentIds` returns a non-null `error` inside `list_projects`
- **THEN** the listing is still returned and ends with an explicit note that child counts are unavailable
- **AND** the failure is logged via `console.error`

#### Scenario: Successful zero count still renders zero

- **WHEN** a count lookup succeeds with `0`
- **THEN** the output renders `0` and no unavailable marker or log line is produced

### Requirement: touchRetrieved failures are logged, reads still succeed

Every `touchRetrieved` call on the thought-retrieval paths (`search_thoughts`, `list_thoughts`, `get_thought_by_id`) SHALL check the returned `error` and log it with a context label via `console.error`. The read result MUST still be returned unchanged (best-effort semantics are preserved). The three call sites SHALL share one helper rather than three logging copies.

#### Scenario: touchRetrieved fails during search_thoughts

- **WHEN** `touchRetrieved` returns a non-null `error` during a `search_thoughts` call
- **THEN** the search results are returned exactly as on success
- **AND** the error is logged via `console.error` with a label identifying the call site

### Requirement: Thrown extraction pipeline appends a visible warning in capture_thought and write_document

When `runExtractionPipeline` throws inside `capture_thought` or `write_document`, the handler SHALL append a warning to its success confirmation stating that reference extraction failed and references were not recorded, mirroring `update_document`'s existing behavior. The operation itself still completes.

#### Scenario: Pipeline throws during capture_thought

- **WHEN** the extraction pipeline throws while capturing a thought
- **THEN** the thought is still captured
- **AND** the confirmation message contains a warning that reference extraction failed

#### Scenario: Pipeline throws during write_document

- **WHEN** the extraction pipeline throws while storing a document
- **THEN** the document is still stored with empty references
- **AND** the confirmation message contains a warning that reference extraction failed

### Requirement: Batch-operation rejection reasons are logged

`freshIngest` and `executeReconciliationPlan` SHALL log the rejection reason of every rejected `Promise.allSettled` result via `console.error` with a site label. The reported failure counts remain derived from the settled results. Logged messages MUST NOT include note content (ids and error messages only).

#### Scenario: One reconciliation op fails

- **WHEN** one operation inside `executeReconciliationPlan` rejects
- **THEN** the summary still reports `1 failed`
- **AND** the rejection reason is logged via `console.error`

#### Scenario: One thought insert fails during freshIngest

- **WHEN** one per-thought insert inside `freshIngest` rejects
- **THEN** the ingest summary still counts that failure
- **AND** the rejection reason is logged via `console.error`
