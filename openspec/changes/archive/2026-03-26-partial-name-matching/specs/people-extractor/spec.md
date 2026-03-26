## MODIFIED Requirements

### Requirement: PeopleExtractor detects known people in note content
The PeopleExtractor SHALL use an LLM call to match person mentions in the note content against the list of known (non-archived) people, returning their UUIDs. The LLM prompt SHALL explicitly instruct the model to match partial names (first name or last name alone) to known people when there is a clear, unambiguous match. When the LLM returns a detected name without a known ID, the PeopleExtractor SHALL fall back to a two-tier name matching algorithm: first exact case-insensitive match, then partial name-part matching that returns a result only when exactly one person matches.

#### Scenario: Note mentions a known person
- **WHEN** a note contains "Meeting with Alice about the project" and "Alice" is a known person
- **THEN** the PeopleExtractor SHALL return Alice's UUID in the result ids array

#### Scenario: Note mentions multiple known people
- **WHEN** a note mentions "Alice and Bob discussed the roadmap" and both are known people
- **THEN** the PeopleExtractor SHALL return both UUIDs in the result ids array

#### Scenario: Note mentions no known people
- **WHEN** a note contains "The weather is nice today" and no person names appear
- **THEN** the PeopleExtractor SHALL return an empty ids array

#### Scenario: Note mentions an unknown person
- **WHEN** a note mentions "Charlie said hello" but "Charlie" is not in the known people list
- **THEN** the PeopleExtractor SHALL NOT create a new person and SHALL return an empty ids array

#### Scenario: Note mentions a known person by first name only
- **WHEN** a note contains "Talked to Bub about the deadline" and the known person is "Bub Goodwin"
- **THEN** the PeopleExtractor SHALL return Bub Goodwin's UUID in the result ids array

#### Scenario: Note mentions a known person by last name only
- **WHEN** a note contains "Goodwin confirmed the schedule" and the known person is "Bub Goodwin"
- **THEN** the PeopleExtractor SHALL return Bub Goodwin's UUID in the result ids array

#### Scenario: Ambiguous partial name match returns no match
- **WHEN** a note contains "Talked to John" and the known people include "John Smith" and "John Doe"
- **THEN** the PeopleExtractor SHALL NOT match either person and SHALL treat "John" as a new/unknown name

#### Scenario: Partial match is case-insensitive
- **WHEN** a note contains "met with goodwin" and the known person is "Bub Goodwin"
- **THEN** the PeopleExtractor SHALL return Bub Goodwin's UUID

#### Scenario: Very short name parts are still matched
- **WHEN** a note contains "Al said yes" and the known person is "Al Green" and no other known person has a name part "Al"
- **THEN** the PeopleExtractor SHALL return Al Green's UUID

## ADDED Requirements

### Requirement: Shared name-part matching utility
The system SHALL provide a shared name-part matching function used by both PeopleExtractor and TaskExtractor. The function SHALL split names on whitespace into parts, ignore parts shorter than 2 characters, and match a candidate name against a list of known people using two tiers: (1) exact case-insensitive full-name match, (2) partial name-part match returning a result only when exactly one person has a matching part.

#### Scenario: Exact match takes priority over partial
- **WHEN** the candidate name is "Alice" and known people include "Alice" and "Alice Cooper"
- **THEN** the matcher SHALL return the ID of the person named exactly "Alice"

#### Scenario: Single partial match returns that person
- **WHEN** the candidate name is "Bub" and the only person with a name part "bub" is "Bub Goodwin"
- **THEN** the matcher SHALL return Bub Goodwin's ID

#### Scenario: Multiple partial matches return no match
- **WHEN** the candidate name is "John" and known people include "John Smith" and "John Doe"
- **THEN** the matcher SHALL return null

#### Scenario: Name parts shorter than 2 characters are ignored
- **WHEN** a known person is named "J Smith" and the candidate name is "J"
- **THEN** the matcher SHALL NOT match because both "J" parts are shorter than 2 characters
