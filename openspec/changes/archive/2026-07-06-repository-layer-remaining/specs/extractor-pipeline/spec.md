## ADDED Requirements

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
