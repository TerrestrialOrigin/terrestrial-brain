## ADDED Requirements

### Requirement: Re-ingest merge preserves fields when resolution is unavailable

When `TaskExtractor` updates a matched (existing) task on re-ingest, it SHALL distinguish, per field (`project_id`, `due_by`, `assigned_to`), between "resolution ran and found no value" (available-empty) and "resolution could not run to completion" (unavailable — the batched LLM call errored, or no capability existed to resolve the field). A field SHALL be written as `null` (cleared) ONLY when its resolution was available-empty. When resolution is unavailable, the extractor SHALL omit that column from the update so the stored value is preserved. When a value is resolved, the extractor SHALL write that value.

#### Scenario: LLM project inference error preserves existing project_id
- **WHEN** a matched task already has `project_id = P` and, on re-ingest, project resolution for its checkbox falls through to LLM inference and the LLM call fails (non-OK response or thrown error)
- **THEN** the update SHALL NOT set `project_id` and the task SHALL retain `project_id = P`

#### Scenario: No known projects preserves existing project_id
- **WHEN** a matched task already has `project_id = P` and, on re-ingest, there are no known projects and no heading/pipeline project resolves for its checkbox
- **THEN** the update SHALL NOT set `project_id` and the task SHALL retain `project_id = P`

#### Scenario: Successful project resolution to a value updates project_id
- **WHEN** a matched task's checkbox resolves to project `Q` (via heading, pipeline reference, or a successful LLM assignment)
- **THEN** the update SHALL set `project_id = Q`

#### Scenario: LLM enrichment error preserves existing due_by and assigned_to
- **WHEN** a matched task already has `due_by = D` and `assigned_to = A`, the note no longer states a date or assignee via fast paths, and the batched enrichment LLM call fails
- **THEN** the update SHALL NOT set `due_by` or `assigned_to` and the task SHALL retain `due_by = D` and `assigned_to = A`

### Requirement: Re-ingest merge clears fields removed from the note when resolution is available

When `TaskExtractor` updates a matched task and resolution for a field completed successfully (available) but found no value — the user removed the date/assignee/project cue from the checkbox — it SHALL clear that field by writing `null`, so the stored task matches the note. This applies consistently to `project_id`, `due_by`, and `assigned_to`.

#### Scenario: Removed due date is cleared
- **WHEN** a matched task previously had `due_by = D`, the re-ingested checkbox contains no date via regex, and the enrichment LLM call succeeds and returns no date for that task
- **THEN** the update SHALL set `due_by = null`

#### Scenario: Removed assignee is cleared
- **WHEN** a matched task previously had `assigned_to = A`, the re-ingested checkbox contains no assignment via fast paths, and the enrichment LLM call succeeds and returns no assignee for that task
- **THEN** the update SHALL set `assigned_to = null`

#### Scenario: Removed project cue clears project_id when inference is available
- **WHEN** a matched task previously had `project_id = P`, no heading or pipeline project resolves, and the LLM project inference call succeeds but does not assign that checkbox to any project
- **THEN** the update SHALL set `project_id = null`

### Requirement: Extraction surfaces Supabase write failures

`TaskExtractor` SHALL check the error channel of every Supabase write it performs — the matched-task update, the parent-link update, the archive-removed update, and the new-task insert — and SHALL surface any write failure in the `ExtractionResult` via an `errors` array rather than silently ignoring it. The extraction pipeline runner SHALL log surfaced errors rather than discarding them.

#### Scenario: Failed matched-task update is surfaced
- **WHEN** the Supabase update for a matched task returns an error
- **THEN** `TaskExtractor.extract` SHALL include a message identifying the failed write in `result.errors`

#### Scenario: Failed archive update is surfaced
- **WHEN** the Supabase archive update for a removed task returns an error
- **THEN** `TaskExtractor.extract` SHALL include a message identifying the failed write in `result.errors`

#### Scenario: Successful extraction reports no errors
- **WHEN** all Supabase writes during extraction succeed
- **THEN** `result.errors` SHALL be absent or empty
