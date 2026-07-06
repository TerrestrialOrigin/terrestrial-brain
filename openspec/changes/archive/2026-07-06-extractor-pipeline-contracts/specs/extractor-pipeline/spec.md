## ADDED Requirements

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
