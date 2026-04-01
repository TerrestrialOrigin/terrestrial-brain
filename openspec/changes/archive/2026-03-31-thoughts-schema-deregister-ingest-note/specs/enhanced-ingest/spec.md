## MODIFIED Requirements

### Requirement: ingest_note populates thoughts with references, snapshot, reliability, and author

All thoughts created or updated during `ingest_note` SHALL receive the `note_snapshot_id` from the snapshot upsert, `metadata.references` from the pipeline, `reliability = 'less reliable'`, and `author = 'gpt-4o-mini'`.

#### Scenario: Fresh ingest thoughts have references, snapshot, reliability, and author
- **WHEN** `ingest_note` performs a fresh ingest (no prior thoughts)
- **THEN** each inserted thought SHALL have `note_snapshot_id` set, `metadata.references` containing `{ projects: [...], tasks: [...] }`, `reliability = 'less reliable'`, and `author = 'gpt-4o-mini'`

#### Scenario: Reconciliation thoughts have references, snapshot, reliability, and author
- **WHEN** `ingest_note` reconciles with existing thoughts (update/add operations)
- **THEN** updated and added thoughts SHALL have `note_snapshot_id` set, `metadata.references` containing `{ projects: [...], tasks: [...] }`, `reliability = 'less reliable'`, and `author = 'gpt-4o-mini'`

### Requirement: ingest_note stores note snapshot

The `ingest_note` function SHALL upsert a row in `note_snapshots` before splitting the note into thoughts. The upsert uses `ON CONFLICT (reference_id) DO UPDATE` to store the latest version. This behavior is unchanged — it operates identically whether called via MCP or via the direct HTTP route.

#### Scenario: First ingest creates snapshot (via HTTP route)
- **WHEN** the `/ingest-note` HTTP endpoint is called with `content`, `title`, and `note_id` for a note not previously ingested
- **THEN** a new row SHALL be inserted into `note_snapshots` with `reference_id = note_id`, `title`, `content`, and `source = 'obsidian'`

#### Scenario: Re-ingest updates snapshot (via HTTP route)
- **WHEN** the `/ingest-note` HTTP endpoint is called with a `note_id` that already has a row in `note_snapshots`
- **THEN** the existing row SHALL be updated with the new `content`, `title`, and `captured_at = now()`
