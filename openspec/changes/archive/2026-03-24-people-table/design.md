## Context

People are currently tracked as unstructured string arrays in `thoughts.metadata.people`, populated by the `extractMetadata()` LLM call. There is no way to:
- Query tasks assigned to a specific person
- Distinguish human collaborators from AI agents
- Reference a canonical person entity across thoughts, tasks, and projects

The existing extraction pipeline (ProjectExtractor → TaskExtractor) provides a proven pattern for adding new entity types with LLM-assisted detection.

## Goals / Non-Goals

**Goals:**
- First-class `people` table with CRUD via MCP tools
- Optional `assigned_to` FK on tasks for person assignment
- PeopleExtractor that detects known-person mentions in notes and writes UUID references into thought metadata
- Pipeline context extended so PeopleExtractor can share state with other extractors

**Non-Goals:**
- Replacing the legacy `metadata.people` string array — it continues to exist for backward compatibility
- Auto-creating people from unrecognized names — only matches against known people
- Authentication/authorization based on people records
- Person-to-project ownership relationships (can be added later)

## Decisions

### 1. Table schema mirrors projects pattern

The `people` table follows the same conventions as `projects`: uuid PK with `gen_random_uuid()`, `archived_at` for soft-delete, `metadata` jsonb, auto-updating `updated_at` trigger. The `type` column is constrained to `'human'` or `'ai'` via CHECK.

**Why:** Consistency with existing tables reduces cognitive load and lets us reuse patterns (archive tool, list with filters, etc.).

**Alternative considered:** Storing people as a JSONB array on projects — rejected because people span multiple projects and need independent lifecycle management.

### 2. `assigned_to` as nullable FK on tasks

A single `assigned_to uuid REFERENCES people(id) ON DELETE SET NULL` column on tasks.

**Why:** Tasks have a single assignee in this system. Multi-assignee would require a junction table, which adds complexity without clear need. The FK with ON DELETE SET NULL ensures archived/deleted people don't break task queries.

**Alternative considered:** Junction table `task_assignments(task_id, person_id)` — deferred until multi-assignee is needed.

### 3. PeopleExtractor runs after TaskExtractor in pipeline

Pipeline order: ProjectExtractor → TaskExtractor → PeopleExtractor. The PeopleExtractor only needs the note content and known people list — it doesn't depend on project or task results, but running last avoids blocking the other extractors.

**Why:** People detection is additive metadata enrichment, not a dependency for project/task extraction. Running last keeps the existing pipeline behavior unchanged.

### 4. LLM-based detection against known people only

The PeopleExtractor sends a batch LLM call with the note summary and the list of known people names. It returns only valid person IDs from the known list — no auto-creation.

**Why:** Auto-creation risks creating duplicate/garbage entries from ambiguous mentions. The user explicitly creates people via `create_person`, then the extractor links them.

### 5. `name` column has UNIQUE constraint

People names must be unique (case-sensitive at DB level). The MCP tools and extractor use case-insensitive matching in application code.

**Why:** Prevents duplicate person records. Case-insensitive matching in the LLM prompt and application layer handles "Alice" vs "alice" without a complex DB constraint.

### Test Strategy

- **Unit tests:** PeopleExtractor detection logic with mock LLM responses (in extractor test file)
- **Integration tests:** Pipeline context enrichment with people, create/list/update/archive MCP tool behavior against local Supabase
- **Mutation check:** Removing PeopleExtractor from pipeline must cause "people references missing" test failures

## Risks / Trade-offs

- **[LLM false positives]** → Mitigation: Only match against known people list; no auto-creation. Worst case is a spurious reference that can be corrected.
- **[Name uniqueness collisions]** → Mitigation: Unique constraint surfaces clear errors; user resolves by using distinguishing names (e.g., "Alice Smith", "Alice Jones").
- **[Migration on existing data]** → Mitigation: `assigned_to` is nullable with no default, so existing task rows are unaffected. New `people` table is additive.

## Migration Plan

1. Apply migration: create `people` table, add `tasks.assigned_to` column + FK
2. Deploy updated edge function with new tools and extractor
3. Seed test data for local development
4. No data migration needed — existing data is unaffected

## Open Questions

None — design is straightforward extension of existing patterns.
