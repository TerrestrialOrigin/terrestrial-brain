## ADDED Requirements

### Requirement: The task extractor is composed of four cohesive modules

The task-extraction code SHALL be organized as four modules: `similarity.ts` (normalization, LCS, prefilters, `computeSimilarity`), `task-reconciliation.ts` (`greedyMatch`, `stripMarkersForComparison`, checkbox reconciliation), `task-inference.ts` (the LLM enrichment and project-inference calls), and `task-extractor.ts` (the extractor class and merge policy). The split SHALL be behavior-preserving: every existing unit and integration test SHALL pass unchanged against the new module layout.

#### Scenario: Modules exist with their assigned responsibilities

- **WHEN** the extractors directory is inspected
- **THEN** the similarity, reconciliation, and inference code live in their own modules and `task-extractor.ts` contains the extractor class and merge policy

#### Scenario: The split preserves behavior

- **WHEN** the full test suite runs after the split
- **THEN** all task-extraction tests pass with zero failures and zero skips

### Requirement: LLM prompt scaffolding is shared, not copied

The entity-list prompt builder, the valid-id allowlist construction, and the call-with-fallback frame around `completeJson` SHALL exist once in a shared `extractors/llm-helpers.ts` (`formatEntityList`, `buildIdAllowlist`, `callJsonWithFallback`) and be consumed by all extractor LLM call sites. Each call site SHALL keep its existing fallback value and logging label so observable behavior is unchanged.

#### Scenario: Call sites consume the shared helpers

- **WHEN** the five LLM call sites in `people-extractor.ts`, `project-extractor.ts`, and the task-inference module are inspected
- **THEN** each builds its entity list, allowlist, and fallback frame through `llm-helpers.ts` rather than a local copy

#### Scenario: Transport failure still degrades per site policy

- **WHEN** the AI provider throws during a scaffolded call
- **THEN** the shared frame logs with the site's label and returns that site's existing fallback sentinel, exactly as before the extraction
