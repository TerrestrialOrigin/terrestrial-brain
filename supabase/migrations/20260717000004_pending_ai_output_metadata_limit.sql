-- Bound get_pending_ai_output_metadata (change: bounded-queries — SQL-3).
-- The RPC returned every pending row with no LIMIT; the only bound was
-- PostgREST's silent max_rows=1000 truncation, so once pending output exceeds
-- 1000 rows the oldest 1000 are returned with NO signal that more exist and
-- newer pending items appear to vanish from the poll. Recreate it with an
-- explicit, caller-supplied bound (default 200) so truncation is deliberate and
-- observable (the edge repository logs when exactly max_rows come back).
--
-- Adding a parameter changes the signature, so the no-arg version is dropped
-- first, then the new one is created and its EXECUTE grant restated (a new
-- signature does not inherit the blanket grant from 20260704000001).
-- Append-only (docs/upgrade.md): no existing migration is edited.

drop function if exists public.get_pending_ai_output_metadata();

create or replace function public.get_pending_ai_output_metadata(max_rows integer default 200)
returns table (
  id uuid,
  title text,
  file_path text,
  content_size bigint,
  created_at timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    ao.id,
    ao.title,
    ao.file_path,
    octet_length(ao.content)::bigint as content_size,
    ao.created_at
  from public.ai_output ao
  where ao.picked_up = false
    and ao.rejected = false
  order by ao.created_at asc
  limit greatest(max_rows, 1);
$$;

revoke execute on function public.get_pending_ai_output_metadata(integer) from public, anon, authenticated;
grant execute on function public.get_pending_ai_output_metadata(integer) to service_role;
