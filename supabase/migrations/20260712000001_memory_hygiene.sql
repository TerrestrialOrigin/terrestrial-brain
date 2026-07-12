-- Memory hygiene (New-Feature-Plan Step 7, change: memory-hygiene). Implements
-- the Step 5 lifecycle rules whose acceptance tests were written red-by-design
-- in Step 6. Append-only (docs/upgrade.md): new columns are nullable, RPCs use
-- create-or-replace, and grants are stated explicitly.

-- ─── New columns ─────────────────────────────────────────────────────────────

-- content_hash: sha256 hex of the current content, stamped in the one server-side
-- update path so the sync dedup gate operates on current text (INVARIANT 1).
alter table public.thoughts add column content_hash text;
alter table public.projects add column content_hash text;
alter table public.tasks add column content_hash text;
alter table public.documents add column content_hash text;

-- superseded_by: contradiction handling by supersession, not deletion. Points a
-- superseded thought at the newer thought that replaces it; the older row is kept
-- (excluded from default search, still fetchable by id, reversible via resolve).
alter table public.thoughts
  add column superseded_by uuid references public.thoughts(id) on delete set null;

-- last_retrieved_at: compliance-independent retrieval-recency signal, advanced on
-- every search/list/get_by_id (built on the Step 2b returned_ids precursor).
alter table public.thoughts add column last_retrieved_at timestamptz;

-- last_actor: the actor (LLM | user | sync) of the last mutation — Invariant 2's
-- structural home, so the console and connectors route through the one path.
alter table public.thoughts add column last_actor text;

create index if not exists idx_thoughts_superseded_by on public.thoughts (superseded_by);
create index if not exists idx_thoughts_last_retrieved_at on public.thoughts (last_retrieved_at);

-- ─── Recreate search RPC to exclude superseded thoughts ──────────────────────
-- Byte-for-byte the body last set in 20260710000001, plus `and superseded_by is
-- null`. Signature/return unchanged, so create-or-replace suffices.

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
    and superseded_by is null
    and (filter_author is null or thoughts.author = filter_author)
    and (filter_reliability is null or thoughts.reliability = filter_reliability)
  order by embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.search_thoughts_by_embedding(extensions.vector(1536), float, int, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.search_thoughts_by_embedding(extensions.vector(1536), float, int, jsonb, text, text) to service_role;

-- ─── Weighted usefulness increment (rubber-stamp down-weighting) ─────────────
-- A selective record (few of a result set) increments more per id than an
-- all-selecting rubber-stamp. The edge function passes the per-id weight; this
-- keeps the increment atomic and server-side, alongside increment_usefulness.

create or replace function increment_usefulness_weighted(thought_ids uuid[], weight int)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update thoughts
  set usefulness_score = usefulness_score + weight
  where id = any(thought_ids);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.increment_usefulness_weighted(uuid[], int) from public, anon, authenticated;
grant execute on function public.increment_usefulness_weighted(uuid[], int) to service_role;
