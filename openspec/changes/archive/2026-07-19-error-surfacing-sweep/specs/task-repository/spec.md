# task-repository — Delta (error-surfacing-sweep)

## ADDED Requirements

### Requirement: Count methods keep data null on error

`countOpenByProject` and `countOpenByAssignee` SHALL return `{ data: null, error }` when the underlying query fails, and `{ data: <count>, error: null }` on success. The envelope MUST never carry a numeric `data` alongside a non-null `error`, so a caller reading `data` without checking `error` cannot mistake a broken count for zero.

#### Scenario: Count query fails

- **WHEN** the underlying count query returns an error
- **THEN** the repository returns `data: null` and a non-null `error`

#### Scenario: Count query succeeds with no rows

- **WHEN** the count query succeeds and matches zero rows
- **THEN** the repository returns `data: 0` and `error: null`
