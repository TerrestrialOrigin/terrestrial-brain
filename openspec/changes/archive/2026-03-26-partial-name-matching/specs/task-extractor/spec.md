## ADDED Requirements

### Requirement: matchPersonInText supports partial name matching
The `matchPersonInText` function SHALL first attempt full-name substring matching (existing behavior), then fall back to individual name-part matching against the text. For partial matches, it SHALL return a result only when exactly one person's name part is found in the text. Full-name matches SHALL take priority over partial matches.

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
