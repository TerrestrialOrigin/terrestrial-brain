create extension if not exists vector with schema extensions;

create table public.thoughts (
  id uuid not null default gen_random_uuid(),
  content text not null,
  embedding extensions.vector(1536) null,
  metadata jsonb null default '{}',
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  reference_id text null,
  constraint thoughts_pkey primary key (id)
);

create index thoughts_embedding_idx on public.thoughts
  using hnsw (embedding extensions.vector_cosine_ops);
create index thoughts_metadata_idx on public.thoughts using gin (metadata);
create index thoughts_created_at_idx on public.thoughts using btree (created_at desc);
create index thoughts_reference_id_idx on public.thoughts using btree (reference_id);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger thoughts_updated_at
  before update on thoughts
  for each row execute function update_updated_at();

-- match_thoughts RPC used by semantic search
create or replace function match_thoughts(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count int,
  filter jsonb default '{}'
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  created_at timestamptz,
  similarity float
)
language sql stable as $$
  select
    id, content, metadata, created_at,
    1 - (embedding <=> query_embedding) as similarity
  from thoughts
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
