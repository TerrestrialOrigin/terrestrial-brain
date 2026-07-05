## MODIFIED Requirements

### Requirement: matchPersonInText supports partial name matching
The `matchPersonInText` function SHALL first attempt full-name substring matching, then fall back to individual name-part matching against the text. In BOTH tiers, a match SHALL count only when the matched substring is bounded on each side by a word boundary — that is, the character immediately before and immediately after the matched substring is either absent (start/end of text) or a non-word character. A character SHALL be considered a word character when it is a Unicode letter or number (`\p{L}` or `\p{N}`), so accented names (e.g. "José") are treated as whole words. For partial matches, it SHALL return a result only when exactly one person's name part is found in the text. Full-name matches SHALL take priority over partial matches, using earliest-position selection among boundary-valid full-name occurrences.

#### Scenario: Full name found in text matches as before
- **WHEN** task text is "Review Bub Goodwin's PR" and "Bub Goodwin" is a known person
- **THEN** matchPersonInText SHALL return Bub Goodwin's ID

#### Scenario: First name found in text matches when unambiguous
- **WHEN** task text is "Ask Bub about the deploy" and the only known person with name part "Bub" is "Bub Goodwin"
- **THEN** matchPersonInText SHALL return Bub Goodwin's ID

#### Scenario: Last name found in text matches when unambiguous
- **WHEN** task text is "Goodwin will handle this" and the only known person with name part "Goodwin" is "Bub Goodwin"
- **THEN** matchPersonInText SHALL return Bub Goodwin's ID

#### Scenario: Ambiguous partial name in text returns no match
- **WHEN** task text is "John will review" and known people include "John Smith" and "John Doe"
- **THEN** matchPersonInText SHALL return null

#### Scenario: Full name match takes priority over partial
- **WHEN** task text is "Alice and Alice Cooper will pair" and known people include "Alice" (id-1) and "Alice Cooper" (id-2)
- **THEN** matchPersonInText SHALL return id-2 (earliest full-name match "Alice Cooper") or id-1 (earliest position "Alice"), following existing earliest-position logic

#### Scenario: Single-word full name embedded in a longer word does not match
- **WHEN** task text is "Planning the sprint" and "Ann" is the only known person
- **THEN** matchPersonInText SHALL return null because "Ann" appears only inside the word "Planning"

#### Scenario: Full name adjacent to punctuation still matches
- **WHEN** task text is "talk to Bub." or "(Bub) owns this" and "Bub Goodwin" is the only person with name part "Bub"
- **THEN** matchPersonInText SHALL return Bub Goodwin's ID because the surrounding punctuation is a word boundary

#### Scenario: Accented name matched as a whole word
- **WHEN** task text is "José reviewed it" and "José" is the only known person
- **THEN** matchPersonInText SHALL return José's ID

#### Scenario: Accented name embedded in a longer word does not match
- **WHEN** task text is "Josély signed off" and "José" is the only known person
- **THEN** matchPersonInText SHALL return null because "José" is followed by the letter "l" and is not a whole word
