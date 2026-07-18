-- Archive retention & purge (change: archive-retention-and-purge — SQL-9).
-- The MCP surface only archives (stamps archived_at); rows persisted forever,
-- including third-party personal data (people.name/email, thought content about
-- named people) — no erasure/retention pathway (GDPR storage-limitation).
--
-- Two service-role-only RPCs over the four archivable tables (thoughts,
-- projects, tasks, people) provide a SQL-free count (dry-run) and hard-delete,
-- plus a 365-day retention cron. target_table is validated against a fixed
-- allowlist before any dynamic %I interpolation. The one cascade —
-- documents.project_id -> projects ON DELETE CASCADE — means purging an archived
-- project also removes its documents; that collateral is reported explicitly so
-- it is never silent. Append-only (docs/upgrade.md).

-- ─── count_archived_rows (dry-run) ──────────────────────────────────────────
create or replace function public.count_archived_rows(
  target_table text default null,
  archived_on_or_before date default null
)
returns table (table_name text, row_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed text[] := array['tasks', 'thoughts', 'people', 'projects'];
  tbl text;
  -- "on that date or older" includes the whole given day; null = all archived.
  cutoff timestamptz := case
    when archived_on_or_before is null then null
    else (archived_on_or_before + 1)::timestamptz
  end;
  scope text[];
  n bigint;
begin
  if target_table is not null and not (target_table = any(allowed)) then
    raise exception 'unknown archivable table: % (allowed: %)', target_table, allowed;
  end if;
  scope := case when target_table is null then allowed else array[target_table] end;

  foreach tbl in array scope loop
    execute format(
      'select count(*) from public.%I where archived_at is not null and ($1 is null or archived_at < $1)',
      tbl
    ) into n using cutoff;
    table_name := tbl;
    row_count := n;
    return next;
  end loop;

  -- Documents cascade-deleted when archived projects are purged.
  if target_table is null or target_table = 'projects' then
    execute
      'select count(*) from public.documents d where d.project_id in ' ||
      '(select p.id from public.projects p where p.archived_at is not null ' ||
      'and ($1 is null or p.archived_at < $1))'
    into n using cutoff;
    if n > 0 then
      table_name := 'documents (via project cascade)';
      row_count := n;
      return next;
    end if;
  end if;
end;
$$;

revoke execute on function public.count_archived_rows(text, date) from public, anon, authenticated;
grant execute on function public.count_archived_rows(text, date) to service_role;

-- ─── purge_archived_rows (hard delete) ──────────────────────────────────────
create or replace function public.purge_archived_rows(
  target_table text default null,
  archived_on_or_before date default null
)
returns table (table_name text, deleted_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Order children -> parents; projects LAST so its cascade to documents runs
  -- after the other tables are already trimmed. All inter-archivable FKs are
  -- SET NULL, so no archivable row is cascade-deleted by another.
  allowed text[] := array['tasks', 'thoughts', 'people', 'projects'];
  tbl text;
  cutoff timestamptz := case
    when archived_on_or_before is null then null
    else (archived_on_or_before + 1)::timestamptz
  end;
  scope text[];
  n bigint;
  doc_n bigint;
begin
  if target_table is not null and not (target_table = any(allowed)) then
    raise exception 'unknown archivable table: % (allowed: %)', target_table, allowed;
  end if;
  scope := case when target_table is null then allowed else array[target_table] end;

  -- Count the cascade collateral BEFORE deleting the projects that trigger it.
  if target_table is null or target_table = 'projects' then
    execute
      'select count(*) from public.documents d where d.project_id in ' ||
      '(select p.id from public.projects p where p.archived_at is not null ' ||
      'and ($1 is null or p.archived_at < $1))'
    into doc_n using cutoff;
  end if;

  foreach tbl in array scope loop
    execute format(
      'delete from public.%I where archived_at is not null and ($1 is null or archived_at < $1)',
      tbl
    ) using cutoff;
    get diagnostics n = row_count;
    table_name := tbl;
    deleted_count := n;
    return next;
  end loop;

  if (target_table is null or target_table = 'projects') and coalesce(doc_n, 0) > 0 then
    table_name := 'documents (via project cascade)';
    deleted_count := doc_n;
    return next;
  end if;
end;
$$;

revoke execute on function public.purge_archived_rows(text, date) from public, anon, authenticated;
grant execute on function public.purge_archived_rows(text, date) to service_role;

-- ─── Best-effort daily 365-day retention schedule via pg_cron ────────────────
-- Mirrors 20260706000002: where pg_cron is available (production Supabase),
-- purge rows archived on or before one year ago daily. Locally / in CI pg_cron
-- may be absent, so the whole attempt is wrapped — the migration MUST still
-- succeed with the RPCs created.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'purge-archived-rows-yearly',
    '0 4 * * *',
    'select public.purge_archived_rows(null, (current_date - 365));'
  );
exception when others then
  raise notice 'pg_cron scheduling skipped (extension unavailable): %', sqlerrm;
end;
$$;
