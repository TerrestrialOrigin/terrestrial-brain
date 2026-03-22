## MODIFIED Requirements

### Requirement: Thought data model
The `thoughts` table SHALL have the following columns: id (uuid), content (text), embedding (vector 1536), metadata (jsonb), created_at, updated_at, reference_id (text, nullable), **note_snapshot_id (uuid, nullable, FK to note_snapshots.id, ON DELETE SET NULL)**.

The `note_snapshot_id` column links a thought to the full source note it was extracted from. It SHALL be:
- Nullable — NULL for thoughts from direct capture, chat, or if the snapshot was purged
- A foreign key referencing `note_snapshots(id)` with `ON DELETE SET NULL`
- Indexed via btree (`thoughts_note_snapshot_id_idx`)

#### Scenario: Thought with note snapshot reference
- **WHEN** a thought is inserted with `note_snapshot_id` set to a valid `note_snapshots.id`
- **THEN** the FK constraint SHALL be satisfied and the row SHALL be created

#### Scenario: Thought without note snapshot reference
- **WHEN** a thought is inserted with `note_snapshot_id` set to NULL
- **THEN** the row SHALL be created (nullable FK allows NULL)

#### Scenario: Invalid note snapshot reference
- **WHEN** a thought is inserted with `note_snapshot_id` set to a UUID that does not exist in `note_snapshots`
- **THEN** the database SHALL reject the insert with a FK violation

#### Scenario: Cascade behavior on snapshot deletion
- **WHEN** a `note_snapshots` row is deleted
- **THEN** all `thoughts` rows referencing that snapshot SHALL have their `note_snapshot_id` set to NULL (not deleted)

#### Scenario: Backwards-compatible metadata references
- **WHEN** existing thoughts have `metadata.references.project_id` (single string format)
- **THEN** application code SHALL read both old format (`{ project_id: "uuid" }`) and new format (`{ projects: ["uuid"], tasks: ["uuid"] }`)
