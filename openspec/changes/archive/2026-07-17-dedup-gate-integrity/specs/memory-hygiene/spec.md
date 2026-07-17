## ADDED Requirements

### Requirement: The write-time dedup gate is enforced atomically and fails safe

The exact-content dedup invariant SHALL be enforced by a database-level partial unique index on `thoughts(content_hash)` restricted to active, non-superseded rows, so two concurrent captures of identical content cannot both create an active row. The edge function SHALL treat the resulting unique-violation (`23505`) as the existing "Already captured" success outcome, not an error. When the dedup lookup itself fails (a read error, not a clean miss), the capture SHALL proceed but SHALL surface that the duplicate check could not run, rather than silently treating the content as new.

#### Scenario: Concurrent identical captures create exactly one active row

- **WHEN** several `capture_thought` calls with byte-identical content run concurrently
- **THEN** exactly one active (non-archived) thought row exists for that content, and the losing captures report "Already captured"

#### Scenario: A failed dedup lookup is surfaced, not swallowed

- **WHEN** the content-hash or embedding-match lookup returns an error
- **THEN** `resolveDedup` reports a degraded outcome and `capture_thought` annotates that the duplicate check was unavailable (it does not silently claim the content is new)
