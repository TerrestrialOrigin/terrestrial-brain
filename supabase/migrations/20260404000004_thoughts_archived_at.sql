-- Add archived_at to thoughts for soft-delete archiving
alter table thoughts add column archived_at timestamptz null;
create index idx_thoughts_archived_at on thoughts (archived_at);

-- Recreate match_thoughts to exclude archived thoughts
drop function if exists match_thoughts(extensions.vector(1536), float, int, jsonb, text, text);

create or replace function match_thoughts(
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
