## Why

People are currently tracked only as unstructured strings in `thoughts.metadata.people` — there's no way to query across the system by person, assign tasks to someone, or distinguish human collaborators from AI agents. Promoting people to a first-class entity enables task assignment, person-scoped queries, and a foundation for access control or team features later.

## What Changes

- **New `people` table** with fields: id, name (unique), type (`human`/`ai`), email, description, metadata, archived_at, created_at, updated_at.
- **New `assigned_to` FK** on `tasks` pointing to `people.id` — nullable, for optional task assignment.
- **New `PeopleExtractor`** in the extraction pipeline that detects person mentions in notes via LLM content analysis against known people, producing `metadata.references.people` arrays on thoughts.
- **New MCP tools**: `create_person`, `list_people`, `get_person`, `update_person`, `archive_person`.
- **Updated extraction pipeline context** to include `knownPeople` and `newlyCreatedPeople`.
- **Updated existing tools**: `list_tasks` and `get_project_summary` now display the assigned person's name; `create_task` and `update_task` accept `assigned_to`.
- **Updated seed data** with test people rows.

## Non-goals

- Replacing the existing `metadata.people` string array on thoughts — the extractor will populate `metadata.references.people` (UUID array) alongside the legacy field.
- User authentication or per-person access control — people are informational entities, not auth principals.
- Automatic person creation from unrecognized names in notes — the extractor only matches against known people.

## Capabilities

### New Capabilities
- `people`: CRUD operations for person entities, person-type enum, soft-delete via archived_at
- `people-extractor`: Extraction of person references from ingested notes into thought metadata

### Modified Capabilities
- `task-extractor`: Tasks gain an optional `assigned_to` FK to people (schema change, no extractor logic change)
- `extractor-pipeline`: Pipeline context extended with `knownPeople` / `newlyCreatedPeople`

## Impact

- **Database**: New migration for `people` table + `tasks.assigned_to` FK column
- **Edge function**: New `tools/people.ts`, new `extractors/people-extractor.ts`, updated `pipeline.ts`, updated `tools/tasks.ts`, updated `tools/queries.ts`, updated `index.ts`
- **Seed data**: `supabase/seed.sql` gains people rows
- **Tests**: New integration tests for PeopleExtractor; updated extractor pipeline tests
