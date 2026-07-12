-- ============================================================================
-- CANONICAL REFERENCE — search_thoughts_by_embedding (always-latest)
-- ============================================================================
-- This file mirrors the CURRENT definition of the search_thoughts_by_embedding
-- function so the live signature/body is discoverable from ONE place instead of
-- "whichever migration sorts last."
--
-- It is a REFERENCE copy, NOT part of the executable apply path. The
-- append-only migrations in supabase/migrations/ remain the single executable
-- source of truth (never edited; each change re-creates the function in full).
--
-- CONVENTION (see docs/upgrade.md): whenever you change
-- search_thoughts_by_embedding, add a NEW migration that re-creates it in full,
-- AND update this file to match, so the two never drift. Last synced with:
--   supabase/migrations/20260712000001_memory_hygiene.sql
-- ============================================================================

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
