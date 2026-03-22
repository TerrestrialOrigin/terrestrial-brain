## 1. Types & Pipeline Framework

- [x] 1.1 Create `extractors/pipeline.ts` with `ExtractionContext`, `ExtractionResult`, and `Extractor` interfaces
- [x] 1.2 Implement `runExtractionPipeline()` — sequential execution, context passing, result composition
- [x] 1.3 Implement context initialization inside `runExtractionPipeline()` — fetch active projects from DB, initialize empty `newlyCreated*` arrays

## 2. ProjectExtractor

- [x] 2.1 Create `extractors/project-extractor.ts` with `ProjectExtractor` class implementing `Extractor`
- [x] 2.2 Implement file path detection — parse `referenceId` for `projects/{name}/` pattern, look up project by name
- [x] 2.3 Implement auto-creation — insert new project row when folder exists but no DB match, enrich context
- [x] 2.4 Implement heading-based detection — case-insensitive comparison of `ParsedNote.headings` against known projects
- [x] 2.5 Implement LLM content matching — focused OpenRouter call with note summary + known projects list, parse JSON response, validate IDs against known list
- [x] 2.6 Implement deduplication — combine all three signals, return unique project IDs
- [x] 2.7 Implement LLM error handling — catch failures, log, continue with deterministic results only

## 3. Testing & Verification

- [x] 3.1 Write pipeline unit tests — mock extractors verifying sequential execution, context enrichment, result composition, empty results
- [x] 3.2 Write ProjectExtractor integration tests — file path detection with known project (CarChief seed data)
- [x] 3.3 Write ProjectExtractor integration tests — heading-based detection with known project
- [x] 3.4 Write ProjectExtractor integration tests — auto-creation from new `/projects/` folder, verify DB row created and context enriched
- [x] 3.5 Write ProjectExtractor integration tests — empty folder name skipped, note outside `/projects/` returns no path match
- [x] 3.6 Write ProjectExtractor integration tests — deduplication when same project matched by multiple signals
- [x] 3.7 Write full pipeline integration test — ProjectExtractor wired into pipeline, verify composed references structure
- [x] 3.8 Run all existing test suites (parse, thoughts, projects, tasks, ai_notes) to verify no regressions
- [x] 3.9 Verify app builds and MCP server starts without errors
