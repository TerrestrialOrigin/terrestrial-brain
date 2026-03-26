## 1. Shared Name-Matching Utility

- [x] 1.1 Create `extractors/name-matching.ts` with `findPersonByName` function implementing two-tier matching: exact case-insensitive full-name match, then partial name-part match (split on whitespace, ignore parts < 2 chars, return only if exactly one person matches)
- [x] 1.2 Create `extractors/name-matching.test.ts` with unit tests: exact match, single partial match (first name), single partial match (last name), ambiguous partial match returns null, short parts ignored, case-insensitive partial, empty inputs

## 2. PeopleExtractor Enhancement

- [x] 2.1 Update `PeopleExtractor.findByName` to delegate to the shared `findPersonByName` utility
- [x] 2.2 Update the LLM prompt in `detectAllPeople` to instruct the model to match partial names (first name or last name alone) to known people when there is a clear match
- [x] 2.3 Add unit tests for PeopleExtractor partial-name matching scenarios (first name only, last name only, ambiguous, case-insensitive)

## 3. TaskExtractor Enhancement

- [x] 3.1 Update `matchPersonInText` to fall back to name-part matching when full-name substring search finds no match, returning a result only when exactly one person's name part is found in the text
- [x] 3.2 Add unit tests for matchPersonInText partial-name matching scenarios (first name in text, last name in text, ambiguous, full-name priority over partial)

## 4. Testing & Verification

- [x] 4.1 Run unit tests across all packages and verify 0 failures, 0 skips
- [x] 4.2 Start Firebase emulators and run E2E tests (`npx playwright test` in `core-full-test`), verify 0 failures, 0 skips
- [x] 4.3 Run `npm run build` to verify the build succeeds
- [x] 4.4 Walk through each delta spec scenario and confirm the implementation handles it
