-- Function call log retention & integrity (Step 25, finding X7 — GDPR data lifecycle).
--
-- function_call_logs stored personal note content (as serialized tool input)
-- and client IPs forever, with no purge path, no size cap, and only a
-- (called_at desc) index. This migration bounds retention and hardens the
-- table's integrity. Input-size truncation is enforced app-side in the logger
-- (logger.ts) so an over-long payload never fails a log insert.

-- ─── (function_name, called_at) index ──────────────────────────────────────
-- Supports time-bounded purge and per-function history queries without a full
-- table scan (the existing idx_function_call_logs_called_at covers called_at
-- alone).
create index if not exists idx_function_call_logs_name_called_at
  on public.function_call_logs (function_name, called_at);

-- ─── Integrity CHECK constraints ────────────────────────────────────────────
-- function_type is only ever 'mcp' or 'http' (set by code, never user input);
-- function_name is a tool/route name, non-empty and bounded. These catch a
-- future code bug that writes a malformed row; existing rows already conform.
alter table public.function_call_logs
  add constraint function_call_logs_function_type_check
    check (function_type in ('mcp', 'http'));

alter table public.function_call_logs
  add constraint function_call_logs_function_name_check
    check (char_length(function_name) between 1 and 100);

-- ─── Retention purge function ───────────────────────────────────────────────
-- Deletes rows older than the given window and returns the count removed.
-- SECURITY DEFINER so a scheduled/edge caller can purge regardless of the
-- invoking role's RLS, but EXECUTE is locked to service_role (below), matching
-- the Step 1 function-privilege convention. search_path is pinned to defuse
-- search-path hijacking of a SECURITY DEFINER function.
create or replace function public.purge_function_call_logs(
  retention_days integer default 90
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.function_call_logs
  where called_at < now() - make_interval(days => retention_days);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.purge_function_call_logs(integer)
  from public, anon, authenticated;
grant execute on function public.purge_function_call_logs(integer)
  to service_role;

-- ─── Best-effort daily schedule via pg_cron ─────────────────────────────────
-- Where pg_cron is available (production Supabase), schedule a daily purge at
-- the 90-day default. Locally / in CI pg_cron may not be in
-- shared_preload_libraries, so the whole attempt is wrapped in an exception
-- handler: the migration MUST still succeed with the purge function created.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'purge-function-call-logs-daily',
    '0 3 * * *',
    'select public.purge_function_call_logs(90);'
  );
exception when others then
  raise notice 'pg_cron scheduling skipped (extension unavailable): %', sqlerrm;
end;
$$;
