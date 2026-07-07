-- Schema cleanup (fix-plan Step 28 / repo-and-schema-tidy)
-- Two concerns, one logical intent: normalize the core tables' invariants.
-- All statements are idempotent / re-runnable and never delete-then-write.

-- ---------------------------------------------------------------------------
-- 1. Mandatory timestamps on the three core tables.
--    Early tables (thoughts/projects/tasks) declared created_at/updated_at as
--    `timestamptz null default now()`; later tables (people/documents) use
--    NOT NULL. Backfill any stray NULLs first, then add the constraint so the
--    migration cannot fail on legacy data.
-- ---------------------------------------------------------------------------

update thoughts
  set created_at = coalesce(created_at, now()),
      updated_at = coalesce(updated_at, now())
  where created_at is null or updated_at is null;

update projects
  set created_at = coalesce(created_at, now()),
      updated_at = coalesce(updated_at, now())
  where created_at is null or updated_at is null;

update tasks
  set created_at = coalesce(created_at, now()),
      updated_at = coalesce(updated_at, now())
  where created_at is null or updated_at is null;

alter table thoughts alter column created_at set not null;
alter table thoughts alter column updated_at set not null;
alter table projects alter column created_at set not null;
alter table projects alter column updated_at set not null;
alter table tasks    alter column created_at set not null;
alter table tasks    alter column updated_at set not null;

-- ---------------------------------------------------------------------------
-- 2. Normalize thought->project references to the single canonical format
--    `metadata.references.projects` (array of UUID strings).
--
--    The legacy shape `metadata.references.project_id` (single string) is
--    unioned into the array (de-duplicated with any existing entries) and the
--    legacy key is dropped. Encapsulated as a per-row function so the exact
--    transform is named, testable, and re-runnable. It is a no-op on a row that
--    does not carry `project_id`, so it is safe to call repeatedly.
-- ---------------------------------------------------------------------------

create or replace function normalize_thought_project_refs(target_id uuid)
returns void
language sql
set search_path = public
as $$
  update thoughts
    set metadata = jsonb_set(
          metadata,
          '{references}',
          (metadata->'references') - 'project_id'
            || jsonb_build_object(
                 'projects',
                 (
                   select coalesce(jsonb_agg(distinct value), '[]'::jsonb)
                   from (
                     select value
                     from jsonb_array_elements(
                       coalesce(metadata->'references'->'projects', '[]'::jsonb)
                     )
                     union
                     select to_jsonb(metadata->'references'->>'project_id')
                   ) as merged(value)
                 )
               )
        )
    where id = target_id
      and metadata->'references' ? 'project_id';
$$;

-- Never expose a mutation helper to public roles (mirrors the S3 posture).
-- Postgres grants EXECUTE to PUBLIC by default, and anon/authenticated inherit
-- it — so revoke from PUBLIC (the effective grant) and re-grant only to
-- service_role. The owner (postgres) retains execute regardless.
revoke execute on function normalize_thought_project_refs(uuid) from public;
grant execute on function normalize_thought_project_refs(uuid) to service_role;

-- One-time normalization of any existing legacy rows.
select normalize_thought_project_refs(id)
from thoughts
where metadata->'references' ? 'project_id';
