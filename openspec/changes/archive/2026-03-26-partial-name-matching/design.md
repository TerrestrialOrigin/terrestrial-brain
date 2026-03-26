## Context

The extraction pipeline detects person mentions in notes. When the LLM fails to resolve a detected name to a known person ID, the `PeopleExtractor.findByName` fallback performs an exact case-insensitive match. If a note says "Bub" but the database has "Bub Goodwin", exact match fails and a duplicate record is created.

The `TaskExtractor.matchPersonInText` has a similar gap: it searches for the full person name as a substring in task text, so it won't find "Bub Goodwin" in text that only says "Bub".

Both extractors need partial name-part matching with ambiguity protection.

## Goals / Non-Goals

**Goals:**
- Match partial name mentions (first name or last name alone) to existing people when the match is unambiguous
- Share the matching algorithm between PeopleExtractor and TaskExtractor
- Improve the LLM prompt to reduce how often fallback matching is needed
- Maintain zero false positives: ambiguous partial matches (e.g., "John" when both "John Smith" and "John Doe" exist) must NOT resolve

**Non-Goals:**
- Nickname/alias resolution ("Bob" → "Robert")
- Fuzzy/phonetic matching (Soundex, Levenshtein)
- Merging existing duplicate records
- Changing auto-creation policy

## Decisions

### Decision 1: Shared name-matching utility

**Choice:** Extract a `matchNamePart` function into a new `extractors/name-matching.ts` module, used by both extractors.

**Rationale:** Both PeopleExtractor and TaskExtractor need the same matching logic. A shared module avoids duplication and ensures consistent behavior. The function is pure (no side effects, no DB access) so it's trivially testable.

**Alternatives considered:**
- Inline the logic in each extractor — rejected because it duplicates the ambiguity logic and risks divergence.
- Add it to `pipeline.ts` — rejected because pipeline is for orchestration, not matching utilities.

### Decision 2: Two-tier matching algorithm

**Choice:** Match in two tiers with strict priority:
1. **Exact match** (full name, case-insensitive) — returns immediately
2. **Partial match** (any name part of the candidate matches any name part of a known person) — returns only if exactly one person matches

Name parts are produced by splitting on whitespace. Parts shorter than 2 characters are ignored to avoid false positives from initials.

**Rationale:** Exact match is always preferred. Partial match is only a fallback, and the single-match constraint prevents guessing between ambiguous candidates.

**Alternatives considered:**
- Weighted scoring (full name > last name > first name) — rejected as over-engineered for the current data set. Can revisit if ambiguity becomes a real problem.
- Matching only first-name-to-first-name and last-name-to-last-name positionally — rejected because user notes don't follow structured name conventions.

### Decision 3: Enhanced LLM prompt

**Choice:** Add an explicit instruction to the `detectAllPeople` system prompt telling the LLM to match partial names (first name or last name alone) to known people when there is a clear match.

**Rationale:** The LLM already receives the full known-people list. An explicit instruction reduces how often the fallback is needed. This is a belt-and-suspenders approach: the prompt change handles the common case; the code-level matching handles LLM misses.

### Decision 4: matchPersonInText enhancement

**Choice:** `matchPersonInText` will first try full-name substring matching (current behavior), then fall back to individual name-part matching. For partial matches, only return a result if exactly one person's name part matches in the text.

**Rationale:** Full-name match is more reliable and should take priority. Partial matching is a fallback for when notes use abbreviated names. The single-match constraint prevents ambiguity.

### Test Strategy

- **Unit tests:** Test the shared `matchNamePart` utility directly with exact, partial, ambiguous, and edge cases.
- **Unit tests:** Test `PeopleExtractor.findByName` and `TaskExtractor.matchPersonInText` to verify they use the new matching correctly.
- **Integration tests:** Existing extractor integration tests in `core-full-test` should be extended with partial-name scenarios.

## Risks / Trade-offs

- **[Risk] Partial match on common names** → Mitigation: The single-match constraint means "John" with both "John Smith" and "John Doe" in the system returns no match. This is conservative but correct — false negatives are better than false positives.
- **[Risk] Short name parts cause false positives** → Mitigation: Minimum part length of 2 characters. A name like "Al" will still match "Al Green" but not match parts of "Alice".
- **[Risk] LLM prompt change could regress other behavior** → Mitigation: The prompt addition is additive (one new instruction) and the code-level matching serves as fallback regardless of LLM behavior.
