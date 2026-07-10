-- Rename the vector-search RPC: match_thoughts → search_thoughts_by_embedding
-- (OB1 fragment rewrite — New-Feature-Plan Step 1). This is behaviour-neutral:
-- the new function has the identical signature, return table, and body as the
-- previous match_thoughts (last re-created in 20260404000004_thoughts_archived_at.sql),
-- only under an original name.
--
-- Append-only convention (docs/upgrade.md): this migration drops the old
-- function and creates the new-named one; earlier migrations are left untouched.

drop function if exists match_thoughts(extensions.vector(1536), float, int, jsonb, text, text);

create or replace function search_thoughts_by_embedding(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count int,
  filter jsonb default '{}',
  filter_author text default null,
  filter_reliability text default null
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float,
  reliability text,
  author text
)
language sql stable
set search_path = public, extensions
as $$
  select
    id, content, metadata, created_at, updated_at,
    1 - (embedding <=> query_embedding) as similarity,
    reliability,
    author
  from thoughts
  where 1 - (embedding <=> query_embedding) > match_threshold
    and archived_at is null
    and (filter_author is null or thoughts.author = filter_author)
    and (filter_reliability is null or thoughts.reliability = filter_reliability)
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- EXECUTE is service_role only, consistent with 20260704000001. The default
-- privileges set there already revoke from public/anon/authenticated for new
-- functions, but state it explicitly so this RPC's grants are self-documenting.
revoke execute on function public.search_thoughts_by_embedding(extensions.vector(1536), float, int, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.search_thoughts_by_embedding(extensions.vector(1536), float, int, jsonb, text, text) to service_role;
