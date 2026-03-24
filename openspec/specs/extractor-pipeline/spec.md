# extractor-pipeline Specification

## Purpose
TBD - created by archiving change people-table. Update Purpose after archive.
## Requirements
### Requirement: ExtractionContext includes people
The `ExtractionContext` interface SHALL include `knownPeople` (array of `{ id: string; name: string }`) and `newlyCreatedPeople` (array of `{ id: string; name: string }`).

#### Scenario: Context populated with existing people
- **WHEN** the pipeline runs and the database contains active (non-archived) people
- **THEN** `ExtractionContext.knownPeople` SHALL contain all active people with their `id` and `name`

#### Scenario: Context with no existing people
- **WHEN** the pipeline runs and the database has no active people
- **THEN** `ExtractionContext.knownPeople` SHALL be an empty array

### Requirement: Pipeline runs PeopleExtractor
The extractor pipeline SHALL include the PeopleExtractor after the TaskExtractor in the standard extraction sequence.

#### Scenario: ingest_note invokes pipeline with PeopleExtractor
- **WHEN** `ingest_note` is called
- **THEN** the pipeline SHALL run with `[ProjectExtractor, TaskExtractor, PeopleExtractor]`

#### Scenario: capture_thought invokes pipeline with PeopleExtractor
- **WHEN** `capture_thought` is called
- **THEN** the pipeline SHALL run with `[ProjectExtractor, TaskExtractor, PeopleExtractor]`

### Requirement: People references stored in thought metadata
After the pipeline runs, the people reference IDs SHALL be stored in `metadata.references.people` on the thought rows, alongside the existing `projects` and `tasks` references.

#### Scenario: Thought metadata includes people references
- **WHEN** the PeopleExtractor detects person IDs ["uuid-a", "uuid-b"]
- **THEN** the thought's `metadata.references.people` SHALL contain `["uuid-a", "uuid-b"]`

#### Scenario: No people detected
- **WHEN** the PeopleExtractor detects no people
- **THEN** the thought's `metadata.references.people` SHALL be an empty array

