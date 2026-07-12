## ADDED Requirements

Convention for every scenario in this capability: a **Tag** line marks it `test` (deterministic —
must always pass in CI) or `eval` (LLM-behavior — scored pass-rate ≥ threshold, opt-in harness,
never a silent skip). Mutation scenarios carry an **Actor** line (`LLM` | `user` | `sync`). There
is exactly ONE ruleset: the memory console and any connector invoke these same rules with their
actor — never a separate, more permissive path (Invariant 2).

### Requirement: Single mutation ruleset parameterized by actor

Every mutation of a thought, project, task, or document SHALL be governed by this one ruleset,
carrying an `actor` of `LLM`, `user`, or `sync`. The system SHALL NOT provide a second, more
permissive mutation path for the memory console or for connectors; where an outcome depends on the
actor, the rule SHALL state the actor-conditioned outcome rather than fork into a parallel ruleset.

#### Scenario: Console edit flows through the same rules as an LLM edit
- **Tag:** test
- **Actor:** user
- **WHEN** a human edits a thought through the memory console
- **THEN** the edit passes through the same server-side update path, validations, and side effects
  (re-embed, re-hash, dedup, supersession checks) as the identical edit made by the `LLM` actor,
  with only the actor recorded differently

#### Scenario: A consent-gated outcome renders per actor but is the same rule
- **Tag:** test
- **Actor:** user
- **WHEN** any actor triggers a consent-gated action (e.g. closing a PMS-origin task)
- **THEN** the same rule fires, surfacing the consent choice as a UI prompt for `user` and as a
  tool-call question for `LLM`, and the underlying state transition is identical

#### Scenario: No unauthorized direct-write surface exists
- **Tag:** test
- **WHEN** a mutation is attempted that would bypass the single server-side update path
- **THEN** it is not authorized — there is no console-only or connector-only write that skips the
  ruleset's validations and side effects

### Requirement: Write-time deduplication gate

The system SHALL apply a server-side embedding-distance deduplication check on every write path
that creates a thought (`capture_thought`, the ingest reconciliation `add` branch, and the
fresh-ingest fallback). The dedup gate SHALL use a tight cosine-distance band (0.05–0.10),
distinct from the 0.5 read-side retrieval threshold. Deduplication SHALL NOT rely on prompt-nudge
compliance.

#### Scenario: Byte-identical capture is blocked
- **Tag:** test
- **Actor:** LLM
- **WHEN** a `capture_thought` writes content whose embedding is within the dedup band of an
  existing active thought (effectively identical)
- **THEN** no new duplicate row is created and the existing thought is retained

#### Scenario: Within-note restatement on ingest is dropped in favor of the existing thought
- **Tag:** test
- **Actor:** sync
- **WHEN** ingest emits a near-duplicate (< dedup band) of a thought that originated from the same
  source note (a restatement)
- **THEN** the existing thought is kept and the restatement is not inserted

#### Scenario: Cross-context near-duplicate is preserved as a supersession candidate, not silently dropped
- **Tag:** test
- **Actor:** LLM
- **WHEN** a new thought is within the dedup band of an existing thought from a different source/context
- **THEN** it is surfaced as a supersession candidate (see contradiction handling) rather than
  silently discarded, so a genuinely new observation cannot vanish

#### Scenario: Distinct content well outside the band is written normally
- **Tag:** test
- **Actor:** LLM
- **WHEN** new content's nearest existing thought is at cosine distance well beyond the dedup band
  (e.g. > 0.15)
- **THEN** the thought is written as a new row with no dedup interference

#### Scenario: Model picks keep-vs-merge correctly at the margin
- **Tag:** eval
- **Actor:** LLM
- **WHEN** two thoughts sit near the edge of the dedup band and require judgment on whether they
  are the same idea
- **THEN** the model's keep/merge choice matches the labeled expectation at or above the eval
  pass-rate threshold

### Requirement: Extraction type is parsed against an allowlist

The system SHALL validate the extracted `type` metadata against the `THOUGHT_TYPES` allowlist at
the extraction seam — parsing, not casting. The allowlist SHALL be
`observation, task, idea, reference, person_note, instruction, decision`. A value outside the
allowlist SHALL map to the fallback `observation` and the coercion SHALL be logged. A hallucinated
`type` SHALL never be stored raw.

#### Scenario: An allowed type is stored as-is
- **Tag:** test
- **Actor:** LLM
- **WHEN** extraction returns a `type` within the allowlist (e.g. `decision`)
- **THEN** the thought is stored with that `type` unchanged

#### Scenario: An out-of-allowlist type is coerced to the fallback and logged
- **Tag:** test
- **Actor:** LLM
- **WHEN** extraction returns a `type` outside the allowlist (e.g. `sentiment`)
- **THEN** the stored `type` is `observation` and the coercion is recorded in the logs, and the raw
  value is not persisted to `metadata.type`

#### Scenario: Missing or unparseable metadata degrades to the documented fallback
- **Tag:** test
- **Actor:** LLM
- **WHEN** extraction fails or returns no `type`
- **THEN** the thought is stored with `type: observation` and `topics: ["uncategorized"]`, logged
  and non-fatal

#### Scenario: Model assigns the right type to ambiguous content
- **Tag:** eval
- **Actor:** LLM
- **WHEN** content could plausibly be more than one allowed type
- **THEN** the model's chosen `type` matches the labeled expectation at or above the eval threshold

### Requirement: Contradiction handling by supersession, not deletion

When new content contradicts an existing thought, the system SHALL record a `supersedes` edge from
the newer to the older thought and retain both; superseded thoughts SHALL be excluded from default
retrieval but remain queryable. The system SHALL NOT delete or overwrite the older thought.
Detection MAY use one AI call in the capture pipeline; an actor MAY invoke an explicit resolve tool.

#### Scenario: A recorded supersession removes the older thought from default search
- **Tag:** test
- **Actor:** LLM
- **WHEN** thought A is superseded by newer thought B via the edge
- **THEN** a default `search_thoughts` returns B and not A, while A remains retrievable by id and
  the edge is queryable

#### Scenario: Supersession never deletes history
- **Tag:** test
- **Actor:** LLM
- **WHEN** a supersession is recorded
- **THEN** the older thought row still exists (soft state, not deleted) so the prior belief is
  auditable and the supersession is reversible via the resolve tool

#### Scenario: Recording a supersession re-embeds the surviving content
- **Tag:** test
- **Actor:** LLM
- **WHEN** a supersession or resolve mutates stored content
- **THEN** the re-embed/re-hash invariant fires on the changed content

#### Scenario: Model detects a genuine contradiction
- **Tag:** eval
- **Actor:** LLM
- **WHEN** new content states the opposite of an existing belief (e.g. "we chose Postgres" then
  later "we switched to SQLite")
- **THEN** the model flags it as a contradiction/supersession candidate at or above the eval
  threshold, and does not flag mere elaborations as contradictions

### Requirement: Usefulness reinforcement with rubber-stamp down-weighting

The system SHALL keep server-side usefulness-score increments. A `record_useful_thoughts` call that
selects nearly all returned ids (a rubber-stamp) SHALL increment less than a selective call over
the same result set. Reinforcement SHALL be an `LLM`-actor mechanism only; `user` and `sync`
mutations SHALL NOT increment usefulness.

#### Scenario: A selective record increments more than a rubber-stamp
- **Tag:** test
- **Actor:** LLM
- **WHEN** two `record_useful_thoughts` calls run over an N-result set — one selecting a few ids,
  one selecting all N
- **THEN** the selective call contributes more usefulness weight per id than the all-selecting call

#### Scenario: get_thought_by_id auto-records server-side
- **Tag:** test
- **Actor:** LLM
- **WHEN** a thought is fetched by id
- **THEN** its usefulness is reinforced server-side without depending on a follow-up nudge

#### Scenario: User and sync edits do not reinforce usefulness
- **Tag:** test
- **Actor:** user
- **WHEN** a human or a sync process edits or reads a thought
- **THEN** no usefulness increment is attributed to that actor

### Requirement: Temporal validity and staleness decay signal

The system SHALL maintain a compliance-independent retrieval signal (`last_retrieved_at`, built on
the logged `returned_ids`) and SHALL surface a staleness review queue via an MCP tool. Staleness
SHALL be computed from multiple signals (age and retrieval recency), never from
`usefulness_score = 0` alone.

#### Scenario: Retrieval updates the recency signal
- **Tag:** test
- **Actor:** LLM
- **WHEN** a thought appears in a search/list result (logged in `returned_ids`)
- **THEN** its retrieval-recency signal advances, independent of whether the model recorded it useful

#### Scenario: Score-zero alone never marks a thought stale
- **Tag:** test
- **WHEN** a thought has `usefulness_score = 0` but was recently retrieved or is recent
- **THEN** it is NOT classified stale — score 0 means "no data," not "not useful"

#### Scenario: Stale-review queue is exposed via a tool
- **Tag:** test
- **WHEN** the staleness review queue is requested
- **THEN** an MCP tool returns the queued items (it is surfaced for review, not auto-applied)

### Requirement: Archival is multi-signal and human-queued

The system SHALL only queue a thought for archival when age AND `usefulness_score = 0` AND no
retrieval signal AND it is not owned by a live synced note all hold. Archival SHALL land in a
review queue for consented action, never auto-applied, and SHALL NOT be driven by usefulness score
alone before the clean-signal maturity date.

#### Scenario: The archival conjunction gates the queue
- **Tag:** test
- **WHEN** a thought is old, score-0, never retrieved, and not owned by a synced note
- **THEN** it appears in the archival review queue; if any one condition fails it does not

#### Scenario: A synced-note-owned thought is never auto-queued for archival
- **Tag:** test
- **Actor:** sync
- **WHEN** a thought is owned by a note that is still actively synced
- **THEN** it is excluded from the archival queue regardless of age or score

#### Scenario: Archiving a queued item is a consented state transition
- **Tag:** test
- **Actor:** user
- **WHEN** a human confirms archival of a queued thought
- **THEN** `archived_at` is stamped and the thought leaves default retrieval; without confirmation
  it stays active

### Requirement: Task reconciliation is consent-based

The system SHALL propose open tasks that appear done based on recent thoughts and SHALL ask before
closing any task — never auto-close. For PMS-origin tasks, the consented-close choice SHALL be
surfaced (close upstream too, or user will do it there); on decline or upstream failure the TB task
SHALL stay open. Locally-born tasks are fully TB-owned.

#### Scenario: Reconciliation asks before closing
- **Tag:** test
- **Actor:** LLM
- **WHEN** the sweep identifies an open task that looks completed
- **THEN** it surfaces a confirm-to-close prompt and does not change status without confirmation

#### Scenario: Declining leaves the task open
- **Tag:** test
- **Actor:** user
- **WHEN** the human declines the proposed close
- **THEN** the task remains open and no status change is written

#### Scenario: Sweep identifies done-looking tasks accurately
- **Tag:** eval
- **Actor:** LLM
- **WHEN** recent thoughts indicate some open tasks are effectively complete
- **THEN** the sweep flags the genuinely-done tasks and not still-open ones at or above the eval
  threshold

### Requirement: Every content edit re-embeds and re-hashes (INVARIANT 1)

The system SHALL, in its one server-side update path, re-embed and re-hash any edit that changes
stored text — thought, project, task, or document content — regardless of actor. Re-embed/re-hash
SHALL NOT live in caller or UI code and SHALL NOT be optional per caller.

#### Scenario: Edited content is found by its new wording
- **Tag:** test
- **Actor:** user
- **WHEN** an entity's content is edited via any path and then searched by its new wording
- **THEN** it matches on the new wording (the old embedding no longer governs retrieval)

#### Scenario: Stored hash equals the hash of the new content
- **Tag:** test
- **Actor:** LLM
- **WHEN** an entity's content is edited
- **THEN** its stored content hash equals the hash computed from the new content, so the sync dedup
  gate operates on current text

#### Scenario: The guarantee holds for projects, tasks, and documents, not only thoughts
- **Tag:** test
- **Actor:** user
- **WHEN** a project description, task content, or document body is edited via any path
- **THEN** the same re-embed + re-hash fires, extending the guarantee `update_thought` already
  provides for thoughts

#### Scenario: Emptying content is a valid edit, still re-hashed
- **Tag:** test
- **Actor:** user
- **WHEN** a user edits an entity to empty or trivial content
- **THEN** the edit is recorded and re-hashed as a valid "loaded but empty" state, never swallowed
  as an error or a no-op
