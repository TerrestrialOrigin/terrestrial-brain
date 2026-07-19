# task-extractor — Delta (quota-metering-accuracy / phase-c-remainder)

## ADDED Requirements

### Requirement: Explicit assignment markers use the shared tiered matcher

`extractAssignment` SHALL resolve `(assigned: X)` / `(owner: X)` candidates through the shared tiered name matcher: an exact full-name match wins; a name-part match applies only when exactly one known person matches; an ambiguous candidate resolves nobody and falls through (marker intact) to the AI path. First-in-list substring containment MUST NOT decide an assignment.

#### Scenario: Exact-part match beats containment order

- **WHEN** known people are ["Bob Smith", "Bo Diddley"] (in that order) and a task says "(assigned: Bo)"
- **THEN** the task is assigned to Bo Diddley

#### Scenario: Ambiguous candidate assigns nobody

- **WHEN** known people are ["Ann Smith", "Ann Jones"] and a task says "(assigned: Ann)"
- **THEN** no fast-path assignment is made and the marker is left for the AI path

### Requirement: An absent enrichment entry preserves stored task fields

When the batched LLM enrichment runs but returns no entry for a given task index (e.g. a truncated completion), the task's stored `due_by` and `assigned_to` SHALL be preserved (treated as unavailable). Only an entry present with explicit null values clears them.

#### Scenario: Omitted task keeps its stored values

- **WHEN** the enrichment response omits the entry for a matched task
- **THEN** the task's update payload omits `due_by` and `assigned_to` (stored values preserved)

#### Scenario: Present entry with nulls clears

- **WHEN** the enrichment response contains the task's entry with `assigned_to_id: null` and `due_date: null`
- **THEN** the stored values are cleared to null (affirmative "nothing found")

### Requirement: One malformed LLM response element never poisons the batch

Every LLM parse callback in the extractors SHALL validate each response array element (and the response object itself) before property access; a malformed element (e.g. `null`, wrong-typed fields) is skipped and the remaining valid elements are applied.

#### Scenario: Null element in enrichments

- **WHEN** the enrichment response is `[null, <valid entry>]`
- **THEN** the valid entry is applied and the null element is ignored

#### Scenario: Null element in project assignments

- **WHEN** the assignment response is `[null, <valid assignment>]`
- **THEN** the valid assignment is applied

### Requirement: Equal-position person matches prefer the more specific name

`findPersonInText`'s full-name tier SHALL break ties at the same earliest position by preferring the longer name, regardless of the order of the known-people list.

#### Scenario: "Ann Smith" beats "Ann"

- **WHEN** the text is "Ann Smith called" and both "Ann" and "Ann Smith" are known (either list order)
- **THEN** the match is "Ann Smith"
