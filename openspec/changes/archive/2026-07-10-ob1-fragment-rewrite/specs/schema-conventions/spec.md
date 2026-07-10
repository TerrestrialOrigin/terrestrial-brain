## RENAMED Requirements

- FROM: `### Requirement: The canonical match_thoughts definition is discoverable from one file`
- TO: `### Requirement: The canonical search_thoughts_by_embedding definition is discoverable from one file`

## MODIFIED Requirements

### Requirement: The canonical search_thoughts_by_embedding definition is discoverable from one file

The current full definition of the `search_thoughts_by_embedding` function SHALL be mirrored in a single canonical reference file (`supabase/schemas/search_thoughts_by_embedding.sql`) that always reflects the latest migration. The migrations remain the executable, append-only source of truth; the canonical file is a human-readable mirror kept in sync by convention documented in `docs/upgrade.md`.

#### Scenario: Canonical file matches the latest migration

- **WHEN** a developer reads `supabase/schemas/search_thoughts_by_embedding.sql`
- **THEN** it SHALL contain the same `create or replace function search_thoughts_by_embedding(...)` body as the latest-sorting migration that (re)defines the function

#### Scenario: Convention documented for future changes

- **WHEN** a developer needs to change `search_thoughts_by_embedding`
- **THEN** `docs/upgrade.md` SHALL instruct them to add a new migration re-creating the function in full AND update the canonical reference file to match
