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

### Requirement: ExtractionContext provides an injected TaskRepository

The `ExtractionContext` interface SHALL include a `taskRepository` field of type
`TaskRepository`. `runExtractionPipeline` SHALL accept the repository as a
parameter and place it on the context it builds, so that `TaskExtractor` performs
its task reads and writes through `context.taskRepository` rather than
`context.supabase.from("tasks")`.

#### Scenario: Context carries the repository

- **WHEN** `runExtractionPipeline(note, extractors, supabase, aiProvider, taskRepository)` runs
- **THEN** the `ExtractionContext` passed to each extractor's `extract` method SHALL have `taskRepository` set to the provided instance

#### Scenario: TaskExtractor uses the injected repository

- **WHEN** `TaskExtractor.extract` updates, creates, or archives tasks
- **THEN** it SHALL call `context.taskRepository` and SHALL NOT call `context.supabase.from("tasks")`

#### Scenario: TaskExtractor unit-testable with a fake repository

- **WHEN** `TaskExtractor.extract` is invoked with an `ExtractionContext` whose `taskRepository` is a fake
- **THEN** the extractor SHALL exercise its reconciliation logic against the fake with no database access

### Requirement: ExtractionContext provides injected Project and Person repositories

The `ExtractionContext` interface SHALL include `projectRepository` and
`personRepository` fields (in addition to the `taskRepository` added in Step 16).
`runExtractionPipeline` SHALL accept both repositories as parameters, seed
`knownProjects` / `knownPeople` / `knownTasks` through them
(`projectRepository.listActive()`, `personRepository.listActive()`,
`taskRepository.findByReference(...)`), and place them on the context it builds —
so `ProjectExtractor` and `PeopleExtractor` perform their reads and writes through
the repositories rather than `context.supabase.from(...)`.

#### Scenario: Context carries the repositories

- **WHEN** `runExtractionPipeline(note, extractors, supabase, aiProvider, taskRepository, projectRepository, personRepository)` runs
- **THEN** the `ExtractionContext` passed to each extractor SHALL have `projectRepository` and `personRepository` set to the provided instances

#### Scenario: Pipeline seeds known lists through repositories

- **WHEN** `runExtractionPipeline` initializes `knownProjects` and `knownPeople`
- **THEN** it SHALL obtain them via the injected repositories and SHALL NOT call `supabase.from("projects")` or `supabase.from("people")`

#### Scenario: Extractors use the injected repositories

- **WHEN** `ProjectExtractor` or `PeopleExtractor` auto-creates a project or person
- **THEN** it SHALL call `context.projectRepository` / `context.personRepository` and SHALL NOT call `context.supabase.from(...)`

#### Scenario: No inline extractor query remains

- **WHEN** `extractors/pipeline.ts`, `extractors/project-extractor.ts`, and `extractors/people-extractor.ts` are searched for `supabase.from(`
- **THEN** no match SHALL be found

### Requirement: Canonical default-extractor factory

The extractor pipeline SHALL expose a single exported factory `createDefaultExtractors()` that returns the standard ordered extractor sequence `[ProjectExtractor, PeopleExtractor, TaskExtractor]`. All callers that run the standard pipeline (`ingest_note`, `capture_thought`, `update_document`) SHALL obtain the extractor list from this factory rather than constructing inline `[new ProjectExtractor(), ...]` literals.

#### Scenario: Factory returns the ordered standard sequence

- **WHEN** `createDefaultExtractors()` is called
- **THEN** it SHALL return three extractors whose `referenceKey`s are, in order, `projects`, `people`, `tasks`

#### Scenario: Factory returns a fresh array each call

- **WHEN** `createDefaultExtractors()` is called twice
- **THEN** it SHALL return two distinct array instances (mutating one SHALL NOT affect the other)

#### Scenario: No inline extractor-list literal remains at call sites

- **WHEN** `tools/thoughts.ts` and `tools/documents.ts` are searched for `new ProjectExtractor(`
- **THEN** no match SHALL be found (every standard-pipeline call site uses `createDefaultExtractors()`)

### Requirement: Reference keys are defined once

The pipeline SHALL define the extractor reference keys (`projects`, `tasks`, `people`) in a single shared `REFERENCE_KEYS` constant. Each extractor's `referenceKey` SHALL be sourced from `REFERENCE_KEYS`, and any cross-extractor read of accumulated references (e.g. `TaskExtractor` reading the projects list produced by `ProjectExtractor`) SHALL key off `REFERENCE_KEYS` rather than a bare string literal.

#### Scenario: Extractors use the shared reference keys

- **WHEN** the `referenceKey` of each concrete extractor is inspected
- **THEN** `ProjectExtractor.referenceKey` SHALL equal `REFERENCE_KEYS.projects`, `TaskExtractor.referenceKey` SHALL equal `REFERENCE_KEYS.tasks`, and `PeopleExtractor.referenceKey` SHALL equal `REFERENCE_KEYS.people`

#### Scenario: TaskExtractor reads the projects reference by shared key

- **WHEN** `TaskExtractor` reads the project ids accumulated by an earlier extractor from `context.accumulatedReferences`
- **THEN** it SHALL index by `REFERENCE_KEYS.projects` rather than a bare `"projects"` literal

### Requirement: Extractor interface documents ordering and side-effect contract

The `Extractor` interface (and `ExtractionResult`) SHALL carry documentation stating (a) that extractors run in a fixed order and a later extractor MAY depend on the `accumulatedReferences` produced by an earlier one (ProjectExtractor before TaskExtractor), and (b) that `extract` performs database writes as a side effect (detect + mutate + enrich), so a mid-pipeline failure MAY leave partial writes, which SHALL be surfaced via `ExtractionResult.errors` rather than swallowed.

#### Scenario: Ordering dependency is documented

- **WHEN** a developer reads the `Extractor` interface in `pipeline.ts`
- **THEN** the documentation SHALL state that ordering is significant and that TaskExtractor depends on ProjectExtractor having run first

#### Scenario: Side-effect contract is documented

- **WHEN** a developer reads the `Extractor` / `ExtractionResult` documentation
- **THEN** it SHALL state that `extract` mutates the database and reports write failures through `ExtractionResult.errors`

### Requirement: ExtractionContext uses shared entity types

The `ExtractionContext` known/newly-created entity fields SHALL be typed with shared, named entity types (`KnownPerson`, `KnownProject`, `KnownTask`) rather than repeated inline `{ id: string; name: string }` / `{ id: string; content: string; reference_id: string | null }` object-literal shapes. `KnownPerson` SHALL be the type already defined for name matching.

#### Scenario: Context fields reference named types

- **WHEN** the `ExtractionContext` interface is inspected
- **THEN** `knownProjects` SHALL be `KnownProject[]`, `knownTasks` SHALL be `KnownTask[]`, and `knownPeople` SHALL be `KnownPerson[]`

#### Scenario: No duplicated inline entity shape remains

- **WHEN** the extractor source files are searched for inline `{ id: string; name: string }` context-field declarations
- **THEN** the shared named types SHALL be used in their place

### Requirement: Pipeline behavior is unit-testable with fakes

The pipeline runner and the deterministic parts of its extractors SHALL be exercisable in unit tests using fake extractors, fake repositories, and a fake `AiProvider`, with no network or database access. This SHALL cover runner ordering, cross-extractor context enrichment, write-failure surfacing, and the PeopleExtractor's validation of LLM output against the known-people allowlist.

#### Scenario: Runner preserves extractor order and enriches context

- **WHEN** `runExtractionPipeline` runs a list of fake extractors that record their invocation order and read `accumulatedReferences`
- **THEN** the extractors SHALL be invoked in list order, and each SHALL observe the references produced by all earlier extractors

#### Scenario: Runner surfaces extractor write failures

- **WHEN** a fake extractor returns an `ExtractionResult` with a non-empty `errors` array
- **THEN** the runner SHALL surface (log) those errors rather than discarding them

#### Scenario: PeopleExtractor rejects a hallucinated person id

- **WHEN** the fake `AiProvider` returns a detected person whose `id` is not in the known-people allowlist
- **THEN** the PeopleExtractor SHALL treat it as a new (unknown) name (`knownId` = null) and SHALL NOT emit the hallucinated id as a known reference

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

