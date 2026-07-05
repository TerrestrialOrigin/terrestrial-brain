## ADDED Requirements

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
