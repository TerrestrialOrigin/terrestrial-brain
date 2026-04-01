## MODIFIED Requirements

### Requirement: Note snapshot storage

The system SHALL store a single snapshot of each note's full content, keyed by `reference_id`. The `note_snapshots` table SHALL have the following columns:
- `id` (uuid, PK, auto-generated)
- `reference_id` (text, NOT NULL, UNIQUE) — the stable identifier (vault-relative path for Obsidian, session ID for other sources)
- `title` (text, nullable)
- `content` (text, NOT NULL)
- `source` (text, nullable, **no default**) — callers MAY provide a free-form value (e.g. `'obsidian'`, `'mcp'`) or omit it
- `captured_at` (timestamptz, NOT NULL, default `now()`)

#### Scenario: Insert a new note snapshot with explicit source
- **WHEN** a row is inserted into `note_snapshots` with a `reference_id` that does not yet exist and `source` is provided
- **THEN** the row SHALL be created with `id` auto-generated, `captured_at` defaulting to now, and `source` set to the provided value

#### Scenario: Insert without source succeeds
- **WHEN** a row is inserted into `note_snapshots` without providing a `source` value
- **THEN** the row SHALL be created with `source` set to NULL

#### Scenario: Upsert an existing note snapshot
- **WHEN** a row is inserted into `note_snapshots` with a `reference_id` that already exists, using `ON CONFLICT (reference_id) DO UPDATE`
- **THEN** the existing row SHALL be updated (not duplicated) — only one row per `reference_id` SHALL exist

#### Scenario: Reference ID uniqueness enforced
- **WHEN** a plain INSERT (no ON CONFLICT) is attempted with a `reference_id` that already exists
- **THEN** the database SHALL reject the insert with a unique constraint violation

#### Scenario: Content is required
- **WHEN** a row is inserted with `content` set to NULL
- **THEN** the database SHALL reject the insert with a NOT NULL violation
