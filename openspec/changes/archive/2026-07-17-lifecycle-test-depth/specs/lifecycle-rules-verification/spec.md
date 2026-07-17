## ADDED Requirements

### Requirement: Shipped lifecycle behaviors are proven behaviorally, not by capability probes

A lifecycle scenario marked `pass-now` in the coverage manifest SHALL be verified by asserting durable behavior (database state or tool output), NOT merely that a tool is registered or a column exists. Deleting or breaking the implementation of a covered behavior SHALL turn its test red.

#### Scenario: The archival conjunction is verified against seeded rows

- **WHEN** a thought satisfying the full archival conjunction and near-miss thoughts each violating exactly one signal are present
- **THEN** the archival queue contains the full-conjunction thought and excludes every near-miss, and a synced-note-owned thought is excluded

#### Scenario: The reconciliation consent invariant is verified against task state

- **WHEN** the reconciliation sweep runs over an open task
- **THEN** the sweep surfaces the task with a confirm-to-close prompt and the task's status remains `open` (the sweep never auto-closes)

#### Scenario: The consent archive is verified against archived_at

- **WHEN** a queued item is archived via the consented tool and another queued item is not
- **THEN** the archived item has `archived_at` stamped and the unconfirmed item stays active

### Requirement: The coverage manifest verifies each pass-now testRef exists and is anchored

The coverage meta-test SHALL assert, for every `pass-now` entry, that its `testRef` file exists; and for every entry carrying a `testNameContains` anchor, that the referenced file contains a `Deno.test` whose name includes the anchor. A testRef pointing at a deleted/renamed file, or an anchor matching no test, SHALL fail the build.

#### Scenario: A dead testRef fails the build

- **WHEN** a pass-now entry's testRef file does not exist
- **THEN** the coverage meta-test fails

#### Scenario: An unmatched anchor fails the build

- **WHEN** an entry's `testNameContains` matches no `Deno.test` name in its testRef file
- **THEN** the coverage meta-test fails
