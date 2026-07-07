## ADDED Requirements

### Requirement: Core tables have mandatory timestamps
The `thoughts`, `projects`, and `tasks` tables SHALL define `created_at` and `updated_at` as `NOT NULL` columns defaulting to `now()`. Any pre-existing NULL values SHALL be backfilled before the constraint is applied, so the migration never fails on legacy data.

#### Scenario: Existing NULL timestamps are backfilled
- **WHEN** the cleanup migration runs against a database where some `thoughts`/`projects`/`tasks` rows have NULL `created_at` or `updated_at`
- **THEN** those NULLs SHALL be set to `now()` before the `NOT NULL` constraint is added, and the migration SHALL complete successfully

#### Scenario: New rows always carry timestamps
- **WHEN** a row is inserted into `thoughts`, `projects`, or `tasks` without specifying `created_at`/`updated_at`
- **THEN** both columns SHALL be populated with the default `now()` and SHALL never be NULL

### Requirement: Thought→project references are stored in a single canonical format
Thought→project references SHALL be stored as `metadata.references.projects` (an array of project UUID strings). A cleanup migration SHALL normalize any legacy `metadata.references.project_id` (single string) rows into the array format and remove the legacy key. The metadata reader SHALL nonetheless remain tolerant of the legacy shape so an unnormalized row never loses its project link.

#### Scenario: Legacy string reference is normalized
- **WHEN** the cleanup migration runs against a thought whose metadata contains `references.project_id = "<uuid>"` and no `references.projects`
- **THEN** the thought's metadata SHALL contain `references.projects = ["<uuid>"]` and SHALL no longer contain `references.project_id`

#### Scenario: Existing array reference is preserved and de-duplicated
- **WHEN** the migration runs against a thought that has both `references.project_id = "<uuid-a>"` and `references.projects = ["<uuid-a>", "<uuid-b>"]`
- **THEN** the resulting `references.projects` SHALL contain `<uuid-a>` and `<uuid-b>` with no duplicates, and the `project_id` key SHALL be removed

#### Scenario: Reader tolerates an unnormalized legacy row
- **WHEN** `getProjectRefs` is given metadata containing only `references.project_id = "<uuid>"`
- **THEN** it SHALL return `["<uuid>"]` rather than an empty array

### Requirement: The canonical match_thoughts definition is discoverable from one file
The current full definition of the `match_thoughts` function SHALL be mirrored in a single canonical reference file (`supabase/schemas/match_thoughts.sql`) that always reflects the latest migration. The migrations remain the executable, append-only source of truth; the canonical file is a human-readable mirror kept in sync by convention documented in `docs/upgrade.md`.

#### Scenario: Canonical file matches the latest migration
- **WHEN** a developer reads `supabase/schemas/match_thoughts.sql`
- **THEN** it SHALL contain the same `create or replace function match_thoughts(...)` body as the latest-sorting migration that (re)defines the function

#### Scenario: Convention documented for future changes
- **WHEN** a developer needs to change `match_thoughts`
- **THEN** `docs/upgrade.md` SHALL instruct them to add a new migration re-creating the function in full AND update the canonical reference file to match

### Requirement: Index-naming convention is documented without renaming existing indexes
The repository SHALL document a single go-forward index-naming convention in `docs/upgrade.md`. Existing indexes SHALL NOT be renamed as part of this change.

#### Scenario: Convention recorded for new indexes
- **WHEN** a developer adds a new index in a future migration
- **THEN** `docs/upgrade.md` SHALL provide the naming convention to follow

#### Scenario: Existing indexes untouched
- **WHEN** the cleanup migration is applied
- **THEN** no existing index SHALL be renamed or dropped
