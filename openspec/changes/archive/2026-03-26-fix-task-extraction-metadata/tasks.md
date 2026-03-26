## 1. Pipeline Reorder & Context

- [x] 1.1 Reorder extraction pipeline in `thoughts.ts` from `[ProjectExtractor, TaskExtractor, PeopleExtractor]` to `[ProjectExtractor, PeopleExtractor, TaskExtractor]` so people results are available to TaskExtractor
- [x] 1.2 Verify PeopleExtractor still works correctly in the new position (it only needs `knownPeople` from context, not task references)

## 2. Metadata Population

- [x] 2.1 Add a helper function `buildTaskMetadata(source, sectionHeading, extractionMethod)` in task-extractor.ts that returns the metadata object
- [x] 2.2 Track extraction method per checkbox during the project association phase (heading_match, file_path, ai_inference, none)
- [x] 2.3 Populate `metadata` in the insert path (Phase 3 — new tasks) using the helper
- [x] 2.4 Populate `metadata` in the update path (Phase 2 — matched tasks) using the helper

## 3. Due Date Extraction

- [x] 3.1 Create a `date-parser.ts` module with regex-based date extraction: ISO dates, natural dates (month + day), relative dates (day-of-week, "tomorrow"), and explicit markers ("due:", "by:", "deadline:")
- [x] 3.2 Add a function to strip the matched date fragment from checkbox text and return both the cleaned content and parsed date
- [x] 3.3 Add LLM batch fallback for checkboxes where regex found nothing but text contains date-like words
- [x] 3.4 Integrate date extraction into TaskExtractor: call it before insert/update, set `due_by` and use cleaned content

## 4. People Assignment

- [x] 4.1 Add a function `matchPersonInText(text, knownPeople)` that does case-insensitive full-name matching against checkbox text, returning the first matched person's UUID or null
- [x] 4.2 In TaskExtractor, resolve `assigned_to` using priority chain: checkbox text match → section heading match → null
- [x] 4.3 Set `assigned_to` in both insert and update paths

## 5. Testing & Verification

- [x] 5.1 Unit tests for `buildTaskMetadata` helper
- [x] 5.2 Unit tests for date-parser: ISO dates, natural dates, relative dates, explicit markers, no-match case, content stripping
- [x] 5.3 Unit tests for `matchPersonInText`: exact match, case-insensitive, multiple people, no match, short names
- [x] 5.4 Integration test: full pipeline run with a note containing checkboxes under headings, dates, and person names — verify metadata, due_by, and assigned_to are populated on resulting task rows
- [x] 5.5 Integration test: re-ingest (reconciliation) verifies metadata is refreshed on update
- [x] 5.6 Run all test suites across packages and verify 0 failures, 0 skips
