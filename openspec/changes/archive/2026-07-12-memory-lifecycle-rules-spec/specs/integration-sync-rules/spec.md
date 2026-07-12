## ADDED Requirements

These rules govern synchronization between an external project-management system (PMS — Jira,
Linear, Todoist, Notion, etc.) and Terrestrial Brain. They are specified now and implemented later
(connectors are v1.5+); they share the `memory-lifecycle-rules` actor model, running as
`actor: sync`. Convention: each scenario carries a **Tag** (`test` deterministic / `eval`
LLM-behavior) and, for mutations, an **Actor** line. The PMS is the system of record for status;
TB observes. TB SHALL NOT compete with the PMS or become one.

### Requirement: PMS-to-TB ingest maps native status, never board columns

The system SHALL ingest PMS items one-way (PMS → TB): a new PMS item maps to a TB project, creates
a TB task, and stores an external reference (ticket key / page id / doc path). Status ingest SHALL
map the PMS API's native status category (e.g. To Do / In Progress / Done), never board-column
semantics. A PMS item completed upstream SHALL mark the corresponding TB task complete if present,
and be ignored if absent.

#### Scenario: New PMS item creates a TB task with an external ref
- **Tag:** test
- **Actor:** sync
- **WHEN** a new PMS item is ingested
- **THEN** a TB task is created under the mapped project with the external reference stored

#### Scenario: Native status category is used, not board columns
- **Tag:** test
- **Actor:** sync
- **WHEN** an ingested item carries a board-specific column (e.g. "In Review", "QA")
- **THEN** TB records the mapped native category (To Do / In Progress / Done), not the raw column name

#### Scenario: Upstream completion of a known task marks it done
- **Tag:** test
- **Actor:** sync
- **WHEN** a PMS item that exists in TB is completed upstream
- **THEN** the TB task is marked done

#### Scenario: Upstream completion of an unknown item is ignored
- **Tag:** test
- **Actor:** sync
- **WHEN** a completion event arrives for a PMS item with no corresponding TB task
- **THEN** it is ignored — no TB task is created from a completion event

### Requirement: One owner per task; PMS owns status for PMS-origin tasks

The system SHALL treat the PMS as the sole owner of status for PMS-origin tasks and treat TB as the
sole owner for locally-born tasks. The two systems SHALL NOT silently disagree on status.

#### Scenario: PMS-origin task status follows upstream
- **Tag:** test
- **Actor:** sync
- **WHEN** a PMS-origin task's status changes upstream
- **THEN** TB updates to match on the next ingest; TB does not originate a competing status

#### Scenario: Locally-born task is fully TB-owned
- **Tag:** test
- **Actor:** user
- **WHEN** a task created inside TB (no external ref) changes status
- **THEN** TB owns it outright and nothing is pushed to any PMS

### Requirement: No autonomous push to the PMS

The system SHALL NOT write to the PMS on its own. Every TB→PMS write SHALL be per-item
human-consented.

#### Scenario: TB never writes upstream unprompted
- **Tag:** test
- **Actor:** sync
- **WHEN** TB detects a change that could propagate to the PMS
- **THEN** no upstream write occurs without an explicit per-item consent

### Requirement: Consented close (TB to PMS)

When a user completes a PMS-origin task in TB, the system SHALL ask whether to close it upstream
too. On yes, it SHALL attempt the upstream close via the PMS API; success closes both. On decline
or upstream failure, the TB task SHALL stay open with a reminder and be completed on the next
ingest once closed upstream.

#### Scenario: Consent yes closes both on success
- **Tag:** test
- **Actor:** user
- **WHEN** the user completes a PMS-origin task in TB and consents to close upstream, and the API
  call succeeds
- **THEN** both the TB task and the PMS item are closed

#### Scenario: Upstream failure keeps the TB task open
- **Tag:** test
- **Actor:** user
- **WHEN** the user consents to close upstream but the PMS API call fails
- **THEN** the TB task stays open with a reminder — the systems never silently diverge — and a
  later ingest closes it once it is closed upstream

#### Scenario: Decline keeps the TB task open
- **Tag:** test
- **Actor:** user
- **WHEN** the user declines to close upstream
- **THEN** the TB task stays open; PMS remains the owner of status

### Requirement: Ask-first creation (TB to PMS)

When a task is born from conversation inside TB, the system SHALL ask whether to create it in the
PMS. Only on consent SHALL it create the item upstream and store the external reference.

#### Scenario: Conversation-born task offered to the PMS
- **Tag:** eval
- **Actor:** LLM
- **WHEN** a new task arises in conversation
- **THEN** the model asks whether to create it in the PMS, phrased as an explicit choice

#### Scenario: Only consent triggers upstream creation
- **Tag:** test
- **Actor:** user
- **WHEN** the user consents to PMS creation
- **THEN** the item is created upstream and its external reference is stored on the TB task; without
  consent, no upstream item is created

### Requirement: Webhook ingest is idempotent under at-least-once delivery

The system SHALL treat webhook delivery as at-least-once: duplicate, retried, or trivial-edit
events SHALL NOT re-trigger extraction or create duplicate rows. A cursor plus content-hash gate
SHALL determine what reaches the LLM, and a low-frequency reconciliation sweep SHALL backstop
silently-missed events.

#### Scenario: Duplicate delivery does not double-ingest
- **Tag:** test
- **Actor:** sync
- **WHEN** the same webhook event is delivered twice
- **THEN** the second delivery is a no-op — no duplicate task/thought and no repeated extraction

#### Scenario: Trivial-edit event below the change gate is ignored
- **Tag:** test
- **Actor:** sync
- **WHEN** an event reflects a change whose content hash is unchanged (or below the change gate)
- **THEN** it does not re-trigger extraction

#### Scenario: Reconciliation sweep recovers a missed event
- **Tag:** test
- **Actor:** sync
- **WHEN** a webhook event is silently missed and the low-frequency sweep runs
- **THEN** the missed change is picked up, and because of the content-hash gate the sweep is a near
  no-op on a quiet day
