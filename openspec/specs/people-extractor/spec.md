# people-extractor Specification

## Purpose
TBD - created by archiving change people-table. Update Purpose after archive.
## Requirements
### Requirement: PeopleExtractor detects known people in note content
The PeopleExtractor SHALL use an LLM call to match person mentions in the note content against the list of known (non-archived) people, returning their UUIDs.

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

