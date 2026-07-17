-- DB policy & function hardening (change: db-policy-and-function-hardening —
-- SQL-1, SQL-4, SQL-8). Append-only (docs/upgrade.md): no existing migration is
-- edited; policies are dropped/recreated and functions are create-or-replaced so
-- signatures and the thoughts_updated_at trigger binding are preserved.

-- ─── SQL-1: function_call_logs policy scoped `to service_role` ───────────────
-- The original policy (20260404000002) was created without a `to` clause, so it
-- attached to ALL roles and relied solely on the deprecated, per-row predicate
-- `auth.role() = 'service_role'`. This is the same structural shape as the
-- historical `people` policy that leaked personal data (fixed in 20260704000001).
-- function_call_logs holds personal data (serialized tool inputs + ip_address),
-- so recreate it in the canonical service_role-scoped shape.

drop policy "Service role full access" on public.function_call_logs;

create policy "Service role full access on function_call_logs"
  on public.function_call_logs
  for all
  to service_role
  using (true)
  with check (true);

-- ─── SQL-4: pin `search_path = public, pg_temp` on definer/trigger functions ──
-- Setting search_path without pg_temp lets PostgreSQL search the session's
-- temporary schema first, so a caller who can create a temp table named
-- `thoughts` could have a SECURITY DEFINER UPDATE resolve to their temp table.
-- Pin pg_temp last, matching the hardened form in 20260706000002. Bodies are
-- unchanged (except the SQL-8 guard below). EXECUTE grants are restated
-- explicitly per the project convention (create-or-replace resets no grants, but
-- restating keeps the privilege posture visible in one place).

create or replace function public.increment_usefulness(thought_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  update thoughts
  set usefulness_score = usefulness_score + 1
  where id = any(thought_ids);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.increment_usefulness(uuid[]) from public, anon, authenticated;
grant execute on function public.increment_usefulness(uuid[]) to service_role;

-- update_updated_at is a trigger function (no grants; triggers fire as the
-- table owner). It previously pinned no search_path at all (Supabase linter 0011).
create or replace function public.update_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── SQL-8: bound the weight on increment_usefulness_weighted ────────────────
-- The RPC applies `usefulness_score + weight` for any integer with no CHECK. The
-- DB is the last boundary before a persistent mutation: an edge-function bug or
-- an LLM-derived value could corrupt every targeted thought's ranking in one
-- call, or overflow `integer`. Reject out-of-range weights loudly (raise, not
-- clamp) so a broken input never renders as a successful mutation.

create or replace function public.increment_usefulness_weighted(thought_ids uuid[], weight int)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  if weight < 1 or weight > 100 then
    raise exception 'weight must be between 1 and 100, got %', weight;
  end if;

  update thoughts
  set usefulness_score = usefulness_score + weight
  where id = any(thought_ids);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.increment_usefulness_weighted(uuid[], int) from public, anon, authenticated;
grant execute on function public.increment_usefulness_weighted(uuid[], int) to service_role;
