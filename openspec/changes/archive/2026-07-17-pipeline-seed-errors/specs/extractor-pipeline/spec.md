## ADDED Requirements

### Requirement: Pipeline aborts on a failed seed read

`runExtractionPipeline` SHALL return a discriminated outcome. When any seed read — active projects, active people, or the note's existing tasks — returns an error, the runner SHALL return a failure outcome (`{ ok: false; error }`) WITHOUT running any extractor and WITHOUT attempting any write. Proceeding with an empty seed is never safe because it converts a transient read failure into duplicate task/project writes.

#### Scenario: Failed known-tasks read aborts without writing

- **WHEN** `taskRepository.findByReference` returns an error during a re-ingest
- **THEN** no extractor runs, no task is inserted, and the outcome is a failure carrying the error message

#### Scenario: Failed active-projects read aborts

- **WHEN** `projectRepository.listActive` returns an error
- **THEN** no extractor runs and the outcome is a failure

#### Scenario: Failed active-people read aborts

- **WHEN** `personRepository.listActive` returns an error
- **THEN** no extractor runs and the outcome is a failure

#### Scenario: Callers surface the abort instead of ingesting

- **WHEN** the pipeline returns a failure outcome to `capture_thought`, `handleIngestNote`, `write_document`, or `update_document`
- **THEN** that tool SHALL return an error result and SHALL NOT write the thought/document (nothing is stored)

### Requirement: Pipeline returns collected extractor write failures

On a successful run, `runExtractionPipeline` SHALL return the reference map together with an `errors` array aggregating every write failure the extractors reported. Each extractor (tasks, people, projects) SHALL populate `ExtractionResult.errors` when an auto-create or update write fails. Callers SHALL append a partial-failure warning to their response when `errors` is non-empty, so a partial failure is never reported as full success.

#### Scenario: Auto-create failure is reported, not swallowed

- **WHEN** `PeopleExtractor` or `ProjectExtractor` fails to insert an auto-created record
- **THEN** the failure message appears in that extractor's `ExtractionResult.errors` and in the pipeline outcome's `errors` array

#### Scenario: Successful run reports an empty errors array

- **WHEN** every extractor write succeeds
- **THEN** the success outcome's `errors` array is empty and no warning is appended to the caller's response
