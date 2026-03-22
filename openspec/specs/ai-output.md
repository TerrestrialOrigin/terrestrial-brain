# AI Output

The reverse data path: AI-generated content delivered to the user's Obsidian vault. Replaces the previous `ai_notes` system with explicit file paths and picked-up tracking.

## Data Model

- **Table:** `ai_output`
- **Fields:** id (uuid, PK, auto-generated), title (text, NOT NULL), content (text, NOT NULL), file_path (text, NOT NULL — full vault-relative path), source_context (text, nullable), created_at (timestamptz, NOT NULL, default now()), picked_up (boolean, NOT NULL, default false), picked_up_at (timestamptz, nullable)
- **Indexes:** partial btree on picked_up WHERE picked_up = false (`ai_output_picked_up_idx`)

---

## Scenarios

### Requirement: AI output storage

The system SHALL store AI-generated output destined for the user's Obsidian vault in the `ai_output` table with the following columns:
- `id` (uuid, PK, auto-generated)
- `title` (text, NOT NULL)
- `content` (text, NOT NULL)
- `file_path` (text, NOT NULL) — full vault-relative path including filename
- `source_context` (text, nullable) — what prompted this output
- `created_at` (timestamptz, NOT NULL, default `now()`)
- `picked_up` (boolean, NOT NULL, default `false`)
- `picked_up_at` (timestamptz, nullable)

#### Scenario: Insert new AI output
- **WHEN** a row is inserted into `ai_output` with `title`, `content`, and `file_path`
- **THEN** the row SHALL be created with `picked_up` defaulting to `false`, `picked_up_at` defaulting to NULL, and `created_at` defaulting to now

#### Scenario: Title is required
- **WHEN** a row is inserted with `title` set to NULL
- **THEN** the database SHALL reject the insert with a NOT NULL violation

#### Scenario: File path is required
- **WHEN** a row is inserted with `file_path` set to NULL
- **THEN** the database SHALL reject the insert with a NOT NULL violation

---

### Requirement: AI output picked-up tracking

The system SHALL track whether each AI output has been picked up by the Obsidian plugin. A partial index on `picked_up` WHERE `picked_up = false` SHALL exist for efficient polling.

#### Scenario: Poll for unpicked output
- **WHEN** a query selects rows where `picked_up = false`
- **THEN** the query plan SHALL use the `ai_output_picked_up_idx` partial index

#### Scenario: Mark output as picked up
- **WHEN** a row's `picked_up` is updated from `false` to `true` and `picked_up_at` is set
- **THEN** the row SHALL no longer appear in queries filtered by `picked_up = false`
