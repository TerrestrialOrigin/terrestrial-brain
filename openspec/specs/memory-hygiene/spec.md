# memory-hygiene Specification

## Purpose
TBD - created by archiving change memory-hygiene. Update Purpose after archive.
## Requirements
### Requirement: Write-time deduplication is enforced server-side

The system SHALL run a server-side deduplication check on every thought-creating
path (`capture_thought`, `freshIngest`, ingest reconciliation) before insert,
using the already-computed embedding (a tight cosine-similarity band) and an
exact `content_hash` match. A byte-identical or within-band restatement SHALL NOT
create a new active row; a cross-context near-duplicate SHALL be retained and
routed to supersession rather than silently dropped.

#### Scenario: Byte-identical capture creates no duplicate

- **WHEN** the same content is captured twice
- **THEN** exactly one active thought row exists afterward

#### Scenario: Distinct content is unaffected

- **WHEN** two clearly different thoughts are captured
- **THEN** both persist as separate active rows

### Requirement: Contradiction handling records a supersession edge

The system SHALL provide a `superseded_by` edge on `thoughts` and a
`resolve_supersession` tool, and `search_thoughts_by_embedding` SHALL exclude
superseded thoughts from default results while they remain retrievable by id. A
capture-time contradiction check MAY set the edge; nothing SHALL delete or
overwrite the older thought.

#### Scenario: A superseded thought is excluded from default search but kept

- **WHEN** a thought is marked superseded via the edge
- **THEN** default `search_thoughts` does not return it, it remains fetchable by
  id, and the row is not deleted

#### Scenario: The resolve tool is registered

- **WHEN** the MCP tool list is inspected
- **THEN** `resolve_supersession` is registered

### Requirement: Every content edit stores a content hash in the one update path

The system SHALL store a `content_hash` on `thoughts`, `projects`, `tasks`, and
`documents`, computed wherever content is written, in the single server-side
update path. A thought content edit SHALL also re-embed. Emptying content SHALL
be a valid, re-hashed edit, never swallowed.

#### Scenario: A content edit updates the stored hash

- **WHEN** an entity's content is edited
- **THEN** its stored `content_hash` equals the hash of the new content

#### Scenario: The hash column exists on all four entities

- **WHEN** the schema is inspected
- **THEN** `content_hash` exists on `thoughts`, `projects`, `tasks`, and `documents`

### Requirement: Mutations record their actor

The system SHALL record a `last_actor` (`LLM` | `user` | `sync`) on thought
mutations through the one update path, defaulting to `LLM` and overridable by the
caller, so the console and connectors later pass `user`/`sync` through the same
path with no parallel ruleset.

#### Scenario: The actor column exists

- **WHEN** the schema is inspected
- **THEN** `thoughts.last_actor` exists

### Requirement: Retrieval advances a recency signal

The system SHALL advance a `last_retrieved_at` timestamp for every thought
returned by `search_thoughts`, `list_thoughts`, or `get_thought_by_id`,
independent of usefulness recording. A touch failure SHALL be non-fatal.

#### Scenario: A fetched thought's recency advances

- **WHEN** a thought is fetched by id
- **THEN** its `last_retrieved_at` is set

### Requirement: Staleness, archival, and reconciliation are human-queued tools

The system SHALL expose `get_stale_thoughts`, `get_archival_queue`, and
`reconcile_tasks` MCP tools that surface review queues (multi-signal, never score
alone; the archival conjunction of age ∧ score-0 ∧ no retrieval ∧ not
synced-note-owned; open tasks that look done). These SHALL be review surfaces —
they SHALL NOT auto-apply archival or auto-close tasks.

#### Scenario: The review tools are registered

- **WHEN** the MCP tool list is inspected
- **THEN** `get_stale_thoughts`, `get_archival_queue`, and `reconcile_tasks` are
  registered

### Requirement: Usefulness reinforcement down-weights rubber-stamps

The system SHALL accept an optional result-set (`returned_ids`) on
`record_useful_thoughts` and increment a selected id **less** when the selection
covers nearly all of the set than when it is selective, via a weighted increment.
Reinforcement SHALL remain server-side.

#### Scenario: A selective record out-weights a rubber-stamp per id

- **WHEN** one call selects a few of an N-result set and another selects all N
- **THEN** the selective call contributes more usefulness per id than the
  all-selecting call

### Requirement: Extraction type is coerced against the allowlist

The system SHALL validate the extracted `type` against `THOUGHT_TYPES`
(`observation, task, idea, reference, person_note, instruction, decision`) and
coerce an out-of-allowlist or missing value to `observation`, logged. A
hallucinated `type` SHALL never be stored raw.

#### Scenario: An out-of-allowlist type is coerced

- **WHEN** extraction returns a `type` outside the allowlist
- **THEN** the stored `type` is `observation`

#### Scenario: An allowlisted type is preserved

- **WHEN** extraction returns an allowlisted `type` (e.g. `decision`)
- **THEN** it is stored unchanged

