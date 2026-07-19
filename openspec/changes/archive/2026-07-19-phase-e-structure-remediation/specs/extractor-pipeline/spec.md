## ADDED Requirements

### Requirement: Pipeline dependencies are a typed deps object

`runExtractionPipeline` SHALL take `(note, extractors, deps)` where `deps` is a typed `ExtractionPipelineDeps` object (aiProvider, repositories, timezone) instead of positional parameters. `ExtractionContext` SHALL NOT expose a raw Supabase client handle — extractors reach persistence only through the injected repositories.

#### Scenario: Pipeline call sites pass a deps object

- **WHEN** the four pipeline call sites in `tools/thoughts.ts` and `tools/documents.ts` invoke `runExtractionPipeline`
- **THEN** they pass a single named-field deps object, and no `supabase` field exists on `ExtractionContext`

#### Scenario: No extractor can bypass the repository seam via context

- **WHEN** the extractors directory is searched for `context.supabase`
- **THEN** no matches exist and the `ExtractionContext` type declares no such field

### Requirement: The user timezone is injected, not read from env mid-extraction

The configured user timezone (`TB_USER_TIMEZONE`) SHALL be read once at the composition root and threaded through the pipeline deps into the extraction context. Extraction logic SHALL NOT call `Deno.env.get` for the timezone during a run.

#### Scenario: Timezone flows through deps

- **WHEN** `TaskExtractor.createRun` needs the timezone
- **THEN** it takes it from the run context (populated from the pipeline deps), and a test can set a timezone by passing it in deps without mutating process env

#### Scenario: No hidden env read in extractors

- **WHEN** `extractors/` is searched for `Deno.env.get`
- **THEN** no timezone read remains inside extraction logic
