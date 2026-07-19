# people-extractor Specification

## Purpose
TBD - created by archiving change people-table. Update Purpose after archive.
## Requirements
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

### Requirement: PeopleExtractor referenceKey
The PeopleExtractor SHALL use `"people"` as its `referenceKey`.

#### Scenario: Reference key value
- **WHEN** the PeopleExtractor produces a result
- **THEN** `result.referenceKey` SHALL equal `"people"`

### Requirement: PeopleExtractor enriches context
The PeopleExtractor SHALL NOT create new people, but it SHALL make its detected IDs available through the extraction result for downstream consumers.

#### Scenario: Detected people appear in result
- **WHEN** the PeopleExtractor detects 2 known people
- **THEN** the result ids array SHALL contain exactly those 2 person UUIDs

### Requirement: PeopleExtractor handles empty known people list
The PeopleExtractor SHALL skip the LLM call entirely when there are no known people in the context.

#### Scenario: No known people
- **WHEN** the pipeline context has an empty `knownPeople` array
- **THEN** the PeopleExtractor SHALL return an empty ids array without making an LLM call

### Requirement: PeopleExtractor handles notes with no content
The PeopleExtractor SHALL return empty results for notes with no meaningful content.

#### Scenario: Empty note
- **WHEN** the note content is empty or contains only whitespace
- **THEN** the PeopleExtractor SHALL return an empty ids array

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


### Requirement: Person auto-create recovers from a name collision

Because `people.name` is unique, a concurrent auto-create of the same new person name makes the losing racer's insert fail with `23505`. The extractor SHALL recover by re-querying the person by name and returning its id, rather than logging and dropping the person reference. If the recovery lookup itself errors, the extractor SHALL return null and record the error.

#### Scenario: Concurrent ingests of the same new person create one row

- **WHEN** two ingests referencing the same not-yet-existing person name run concurrently
- **THEN** exactly one person row exists for that name and both runs resolve to the same person id

#### Scenario: A unique violation recovers the existing id

- **WHEN** an auto-create insert returns `23505`
- **THEN** the extractor returns the existing person's id and records no error (the reference is not dropped)

### Requirement: One malformed detection element never poisons the batch

The people-detection parse callback SHALL validate each response element before property access; a malformed element (e.g. `null`) is skipped and the remaining valid detections are applied.

#### Scenario: Null element in detections

- **WHEN** the detection response is `[null, { name: "Alice", id: <known id> }]`
- **THEN** Alice is still detected and referenced
