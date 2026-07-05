## ADDED Requirements

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
