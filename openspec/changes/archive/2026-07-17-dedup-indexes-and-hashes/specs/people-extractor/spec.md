## ADDED Requirements

### Requirement: Person auto-create recovers from a name collision

Because `people.name` is unique, a concurrent auto-create of the same new person name makes the losing racer's insert fail with `23505`. The extractor SHALL recover by re-querying the person by name and returning its id, rather than logging and dropping the person reference. If the recovery lookup itself errors, the extractor SHALL return null and record the error.

#### Scenario: Concurrent ingests of the same new person create one row

- **WHEN** two ingests referencing the same not-yet-existing person name run concurrently
- **THEN** exactly one person row exists for that name and both runs resolve to the same person id

#### Scenario: A unique violation recovers the existing id

- **WHEN** an auto-create insert returns `23505`
- **THEN** the extractor returns the existing person's id and records no error (the reference is not dropped)
