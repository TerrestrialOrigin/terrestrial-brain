## MODIFIED Requirements

### Requirement: Usefulness reinforcement down-weights rubber-stamps

The system SHALL accept an optional result-set (`returned_ids`) on
`record_useful_thoughts` and increment a selected id **less** when the selection
covers nearly all of the set than when it is selective, via a weighted increment.
Reinforcement SHALL remain server-side. The weighted increment RPC SHALL validate
its `weight` argument is within `[1, 100]` and SHALL reject an out-of-range value
(zero, negative, or above the bound) by raising an error before any mutation, so a
caller bug or LLM-derived value cannot corrupt or integer-overflow the persistent
`usefulness_score`.

#### Scenario: A selective record out-weights a rubber-stamp per id

- **WHEN** one call selects a few of an N-result set and another selects all N
- **THEN** the selective call contributes more usefulness per id than the
  all-selecting call

#### Scenario: An out-of-range weight is rejected before mutation

- **WHEN** the weighted usefulness RPC is called with a `weight` of 0, a negative value, or a value above 100
- **THEN** the call raises an error and no thought's `usefulness_score` changes

#### Scenario: An in-range weight is applied

- **WHEN** the weighted usefulness RPC is called with a `weight` within `[1, 100]` for an existing thought
- **THEN** that thought's `usefulness_score` increases by exactly the weight
