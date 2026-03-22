## MODIFIED Requirements

### Requirement: Pipeline wired into MCP tools

The extractor pipeline SHALL be invoked by the `ingest_note` and `capture_thought` MCP tools during normal operation, not only in standalone test scenarios.

#### Scenario: ingest_note invokes pipeline
- **WHEN** `ingest_note` is called
- **THEN** the pipeline SHALL run with `[ProjectExtractor, TaskExtractor]` against the structurally parsed note

#### Scenario: capture_thought invokes pipeline
- **WHEN** `capture_thought` is called
- **THEN** the pipeline SHALL run with `[ProjectExtractor, TaskExtractor]` against the structurally parsed content
