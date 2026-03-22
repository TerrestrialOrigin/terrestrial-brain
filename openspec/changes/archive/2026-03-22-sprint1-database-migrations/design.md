## Context

The current Terrestrial Brain database has three main tables: `thoughts`, `projects`, and `ai_notes`. Upcoming sprints (3-7) require:

1. **Source note storage** — extractors need the full note text to parse checkboxes/headings, and the AI needs to retrieve the original note a thought came from.
2. **A cleaner AI→Obsidian delivery model** — the current `ai_notes` table uses `synced_at` timestamps and `terrestrialBrainExclude` frontmatter to prevent re-ingestion. The new model uses explicit file paths and a `picked_up` boolean, and delivered files participate in normal ingest.
3. **Multi-entity references on thoughts** — the current `metadata.references.project_id` is a single string. The extractor pipeline produces arrays of project and task IDs.

This sprint creates the schema foundation. No application code changes — only DDL and pgTAP tests.

**Constraints:**
- Supabase manages migrations via `supabase/migrations/` directory (timestamped SQL files).
- The `thoughts` table has existing production data — migrations must be non-destructive.
- The `ai_notes` table stays intact this sprint; migration and removal happen in Sprint 6.

## Goals / Non-Goals

**Goals:**
- Create `note_snapshots` table with upsert-on-`reference_id` semantics
- Create `ai_output` table with `picked_up` tracking and partial index
- Add nullable `note_snapshot_id` FK to `thoughts` with `ON DELETE SET NULL`
- Validate all constraints via pgTAP tests

**Non-Goals:**
- Populating `note_snapshots` during ingest (Sprint 5)
- Building MCP tools for `ai_output` (Sprint 6)
- Migrating data from `ai_notes` to `ai_output` (Sprint 6)
- Dropping `ai_notes` (Sprint 6)
- Changing `metadata.references` format in application code (Sprint 5) — the jsonb column is schema-less, so no DDL is needed for the format change; it's a convention enforced in code

## Decisions

### 1. Single migration file vs. multiple

**Decision:** One migration file containing all three DDL changes (two CREATE TABLE + one ALTER TABLE).

**Rationale:** These changes are atomic — `thoughts.note_snapshot_id` references `note_snapshots`, so they must exist in the same transaction. Splitting into separate files risks partial application. One file keeps the dependency explicit.

**Alternative considered:** Separate files per table. Rejected because the FK dependency makes ordering critical, and a single transaction is cleaner.

### 2. `note_snapshots.reference_id` as UNIQUE TEXT, not UUID

**Decision:** `reference_id` is `TEXT NOT NULL UNIQUE` — it holds vault-relative paths for Obsidian notes (e.g., `"projects/CarChief/planning.md"`) or session IDs for other sources.

**Rationale:** UUIDs would require a mapping layer between file paths and IDs. Since we upsert on `reference_id`, it must be the natural key. Text accommodates both file paths and future non-Obsidian sources.

### 3. `ai_output` partial index on `picked_up = false`

**Decision:** Use a partial index `WHERE picked_up = false` on the `picked_up` column.

**Rationale:** The plugin polls for unpicked rows. Over time, the vast majority of rows will be `picked_up = true`. A partial index keeps the poll query fast without indexing the entire table.

### 4. `ON DELETE SET NULL` for `thoughts.note_snapshot_id`

**Decision:** Deleting a `note_snapshots` row sets `thoughts.note_snapshot_id` to NULL rather than cascading the delete.

**Rationale:** Thoughts are the primary knowledge unit and must survive snapshot purges. A thought's value doesn't depend on having the source note available — it's self-contained.

### 5. No DDL for `metadata.references` format change

**Decision:** The jsonb column `thoughts.metadata` requires no schema change. The format change from `{ project_id: "uuid" }` to `{ projects: [...], tasks: [...] }` is a convention enforced in application code (Sprint 5).

**Rationale:** PostgreSQL jsonb is schema-less. Adding a CHECK constraint would be fragile and hard to evolve. Backwards-compatible reads in application code (Sprint 5) handle both old and new formats.

### Test Strategy

All testing for this sprint is at the **database layer using pgTAP**:
- Constraint validation (PK, FK, UNIQUE, NOT NULL, defaults)
- Upsert behavior (`ON CONFLICT` on `note_snapshots.reference_id`)
- Cascade behavior (`ON DELETE SET NULL`)
- Partial index filtering (`ai_output.picked_up = false`)

No unit, integration, or E2E application tests — there's no application code changing this sprint.

## Risks / Trade-offs

- **[Risk] `note_snapshots` stores full note content → storage growth** → Mitigation: One row per note (upserted), not versioned. Future: add a retention policy or `content` compression if storage becomes an issue.
- **[Risk] `ai_output` has no per-user scoping** → Mitigation: Terrestrial Brain is single-user. If multi-user is ever needed, add a `user_id` column in a future migration.
- **[Risk] `ai_notes` and `ai_output` coexist temporarily** → Mitigation: Both tables are independent. Sprint 6 handles migration and cleanup. No naming conflicts.

## Migration Plan

1. Create migration file: `supabase/migrations/<timestamp>_create_note_snapshots_ai_output.sql`
2. Apply locally with `supabase db reset` or `supabase migration up`
3. Validate with pgTAP tests
4. Deploy to production via `supabase db push` (after Sprint 1 PR is merged)

**Rollback:** Drop the new tables and column in reverse order:
```sql
ALTER TABLE public.thoughts DROP COLUMN IF EXISTS note_snapshot_id;
DROP TABLE IF EXISTS public.ai_output;
DROP TABLE IF EXISTS public.note_snapshots;
```

## Open Questions

None — the schema is fully specified in SyncChanges.md and this design confirms the approach.
