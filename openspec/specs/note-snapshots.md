# Note Snapshots

Stores the latest full text of each ingested note, keyed by a stable reference identifier. Enables source-note retrieval and extractor pipeline access.

## Data Model

- **Table:** `note_snapshots`
- **Fields:** id (uuid, PK, auto-generated), reference_id (text, NOT NULL, UNIQUE), title (text, nullable), content (text, NOT NULL), source (text, NOT NULL, default 'obsidian'), captured_at (timestamptz, NOT NULL, default now())
- **Indexes:** btree on reference_id (`note_snapshots_reference_id_idx`), btree on source (`note_snapshots_source_idx`)

---

## Scenarios

### Requirement: Note snapshot storage

The system SHALL store a single snapshot of each note's full content, keyed by `reference_id`. The `note_snapshots` table SHALL have the following columns:
- `id` (uuid, PK, auto-generated)
- `reference_id` (text, NOT NULL, UNIQUE) — the stable identifier (vault-relative path for Obsidian, session ID for other sources)
- `title` (text, nullable)
- `content` (text, NOT NULL)
- `source` (text, NOT NULL, default `'obsidian'`)
- `captured_at` (timestamptz, NOT NULL, default `now()`)

#### Scenario: Insert a new note snapshot
- **WHEN** a row is inserted into `note_snapshots` with a `reference_id` that does not yet exist
- **THEN** the row SHALL be created with `id` auto-generated, `captured_at` defaulting to now, and `source` defaulting to `'obsidian'`

#### Scenario: Upsert an existing note snapshot
- **WHEN** a row is inserted into `note_snapshots` with a `reference_id` that already exists, using `ON CONFLICT (reference_id) DO UPDATE`
- **THEN** the existing row SHALL be updated (not duplicated) — only one row per `reference_id` SHALL exist

#### Scenario: Reference ID uniqueness enforced
- **WHEN** a plain INSERT (no ON CONFLICT) is attempted with a `reference_id` that already exists
- **THEN** the database SHALL reject the insert with a unique constraint violation

#### Scenario: Content is required
- **WHEN** a row is inserted with `content` set to NULL
- **THEN** the database SHALL reject the insert with a NOT NULL violation

---

### Requirement: Note snapshot indexes

The system SHALL maintain btree indexes on `reference_id` and `source` for efficient lookups.

#### Scenario: Query by reference_id uses index
- **WHEN** a query filters `note_snapshots` by `reference_id`
- **THEN** the query plan SHALL use the `note_snapshots_reference_id_idx` index
