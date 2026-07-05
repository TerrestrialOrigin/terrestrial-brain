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

### Requirement: ExtractionContext provides an injected AiProvider

The `ExtractionContext` interface SHALL include an `aiProvider` field of type
`AiProvider`. `runExtractionPipeline` SHALL accept the provider as a parameter
and place it on the context it builds, so that extractors obtain the LLM through
`context.aiProvider` rather than importing environment variables or constructing
`fetch` calls themselves.

#### Scenario: Context carries the provider
- **WHEN** `runExtractionPipeline(note, extractors, supabase, aiProvider)` runs
- **THEN** the `ExtractionContext` passed to each extractor's `extract` method SHALL have `aiProvider` set to the provided instance

#### Scenario: Extractors use the injected provider
- **WHEN** an extractor needs an LLM detection/inference call during `extract`
- **THEN** it SHALL call `context.aiProvider` and SHALL NOT read `OPENROUTER_API_KEY` or call `fetch` directly

#### Scenario: Extractor unit-testable with a fake
- **WHEN** an extractor's `extract` is invoked with an `ExtractionContext` whose `aiProvider` is a fake
- **THEN** the extractor SHALL exercise its detection logic against the fake with no network access

