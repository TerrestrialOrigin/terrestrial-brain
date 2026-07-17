## ADDED Requirements

### Requirement: Reconciliation plan is validated and id-allowlisted before mutation

The note-reconciliation LLM plan SHALL be validated against a runtime schema before it drives any mutation. A structurally invalid plan — a non-array `keep`/`update`/`add`/`delete`, an `update` entry without a non-empty `content`, or an `add` entry that is not a non-empty string — SHALL be treated as unparseable and degrade to a fresh ingest (no reconciliation mutations). Every id in `keep`/`update`/`delete` SHALL be intersected against the ids of THIS note's existing thoughts; any id not in that set SHALL be dropped (and logged) so it can never reach `update` or `archive`.

#### Scenario: A hallucinated foreign id is dropped before mutation

- **WHEN** the plan's `update` or `delete` contains a valid-shaped UUID that is not one of this note's existing thoughts
- **THEN** that id is removed from the plan and no update/archive is issued for it

#### Scenario: A structurally invalid plan degrades to fresh ingest

- **WHEN** the plan has a non-array field, an `update` entry missing `content`, or an object-shaped `add` entry
- **THEN** reconciliation is abandoned and the note is fresh-ingested instead (no partial mutation from the malformed plan)

#### Scenario: A valid plan whose ids all belong to the note is applied unchanged

- **WHEN** every `keep`/`update`/`delete` id belongs to this note's existing thoughts and the shape is valid
- **THEN** the plan is applied as given
