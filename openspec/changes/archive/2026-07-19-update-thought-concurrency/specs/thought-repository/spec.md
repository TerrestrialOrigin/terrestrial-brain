# thought-repository — Delta (update-thought-concurrency)

## ADDED Requirements

### Requirement: update supports an optimistic-concurrency guard

`ThoughtRepository.update` SHALL accept an optional `expectedUpdatedAt` guard. When provided, the implementation MUST filter the update on `updated_at = expectedUpdatedAt` in addition to the id, and the result MUST report whether a row actually matched (matched row identity, or `null` when nothing matched). Without the guard, behavior is unchanged. `findForUpdate` SHALL include `updated_at` in the row it returns so callers can supply the guard.

#### Scenario: Guarded update with a stale timestamp matches nothing

- **WHEN** `update` is called with an `expectedUpdatedAt` that no longer matches the row
- **THEN** no row is modified
- **AND** the result carries `data: null` with `error: null`

#### Scenario: Guarded update with the current timestamp applies

- **WHEN** `update` is called with the row's current `updated_at`
- **THEN** the row is updated
- **AND** the result carries the matched row's id

#### Scenario: Unguarded update keeps prior behavior

- **WHEN** `update` is called without `expectedUpdatedAt`
- **THEN** the update filters on id only, exactly as before
