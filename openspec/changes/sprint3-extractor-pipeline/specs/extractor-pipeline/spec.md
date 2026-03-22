## ADDED Requirements

### Requirement: Extractor interface contract
The system SHALL define an `Extractor` interface with a `referenceKey` property (string) and an `extract(note: ParsedNote, context: ExtractionContext): Promise<ExtractionResult>` method. `ExtractionResult` SHALL contain `referenceKey` (string) and `ids` (string array of entity PKs).

#### Scenario: Extractor returns structured result
- **WHEN** an extractor processes a parsed note
- **THEN** it SHALL return an `ExtractionResult` with its `referenceKey` and an array of matched/created entity IDs

#### Scenario: Extractor returns empty result
- **WHEN** an extractor finds no matching entities in a parsed note
- **THEN** it SHALL return an `ExtractionResult` with an empty `ids` array (not null, not undefined)

### Requirement: Extraction context with enrichment
The system SHALL define an `ExtractionContext` containing: a Supabase client, `knownProjects` array (`{ id, name }`), `knownTasks` array (`{ id, content, reference_id }`), `newlyCreatedProjects` array (`{ id, name }`), and `newlyCreatedTasks` array (`{ id, content }`). Extractors SHALL be able to append to the `newlyCreated*` arrays to enrich context for downstream extractors.

#### Scenario: Context enrichment visible to downstream extractors
- **WHEN** ExtractorA adds a project to `context.newlyCreatedProjects`
- **AND** ExtractorB runs after ExtractorA in the pipeline
- **THEN** ExtractorB SHALL see the project added by ExtractorA in `context.newlyCreatedProjects`

### Requirement: Pipeline runner executes extractors sequentially
The system SHALL provide a `runExtractionPipeline(note, extractors, baseContext)` function that iterates extractors in array order, calling each extractor's `extract()` method and collecting results. It SHALL return a `Record<string, string[]>` mapping each extractor's `referenceKey` to its extracted IDs.

#### Scenario: Single extractor pipeline
- **WHEN** the pipeline runs with one extractor that returns `{ referenceKey: "projects", ids: ["uuid1"] }`
- **THEN** the pipeline SHALL return `{ "projects": ["uuid1"] }`

#### Scenario: Multiple extractor pipeline
- **WHEN** the pipeline runs with two extractors returning `{ referenceKey: "projects", ids: ["p1"] }` and `{ referenceKey: "tasks", ids: ["t1", "t2"] }`
- **THEN** the pipeline SHALL return `{ "projects": ["p1"], "tasks": ["t1", "t2"] }`

#### Scenario: Extractors run in order
- **WHEN** the pipeline receives extractors `[A, B, C]`
- **THEN** it SHALL call `A.extract()` first, then `B.extract()`, then `C.extract()` — never in parallel

#### Scenario: Pipeline with extractor returning no results
- **WHEN** the pipeline runs with an extractor that returns `{ referenceKey: "projects", ids: [] }`
- **THEN** the pipeline SHALL include `"projects": []` in the returned record

### Requirement: Pipeline initializes context
The pipeline runner SHALL accept a `baseContext` with a Supabase client. It SHALL fetch active (non-archived) projects from the DB and populate `knownProjects`. It SHALL initialize `newlyCreatedProjects` and `newlyCreatedTasks` as empty arrays.

#### Scenario: Context populated with existing projects
- **WHEN** the pipeline runs and the database contains active projects
- **THEN** the `ExtractionContext.knownProjects` SHALL contain all active projects with their `id` and `name`

#### Scenario: Context with no existing projects
- **WHEN** the pipeline runs and the database has no active projects
- **THEN** `ExtractionContext.knownProjects` SHALL be an empty array
