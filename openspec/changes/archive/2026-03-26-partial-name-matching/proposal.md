## Why

People extraction currently uses exact case-insensitive name matching as its fallback when the LLM fails to resolve a person. If a note mentions "Bub" but the known person is "Bub Goodwin", the match fails and a duplicate person record "Bub" gets auto-created. The same applies to last-name-only mentions. This produces duplicate rows in the people table that must be manually cleaned up.

## What Changes

- Enhance `findByName` in `PeopleExtractor` to try partial name-part matching (first name, last name) when exact match fails, returning a match only when it is unambiguous (exactly one person matches).
- Enhance the LLM prompt in `detectAllPeople` to explicitly instruct the model to match partial names (first or last name alone) to known people.
- Enhance `matchPersonInText` in `TaskExtractor` to also try matching individual name parts of known people against task text, with full-name matches taking priority over partial matches.
- Extract the shared partial-matching logic into a reusable utility so both extractors use the same algorithm.

## Non-goals

- Nickname or alias support (e.g., "Bob" matching "Robert") — out of scope for this change.
- Fuzzy/phonetic matching (e.g., Soundex, Levenshtein) — too risky for false positives.
- Merging existing duplicate person records — that's a separate data cleanup task.
- Changing the auto-creation behavior itself — the question of whether PeopleExtractor should auto-create is a separate concern.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `people-extractor`: The fallback name matching now supports partial (first/last name) matching with ambiguity detection, and the LLM prompt is updated to prefer matching partial names to known people.
- `task-extractor`: `matchPersonInText` now matches individual name parts of known people against task text, with full-name matches taking priority.

## Impact

- **Code**: `people-extractor.ts` (findByName, LLM prompt), `task-extractor.ts` (matchPersonInText), new shared utility for name-part matching.
- **Behavior change**: Notes that previously created duplicate person records for partial name mentions will now correctly resolve to the existing person — but only when the match is unambiguous.
- **Risk**: If two people share a first or last name (e.g., "John Smith" and "John Doe"), a mention of just "John" will correctly remain unresolved (no match) rather than guessing wrong.
