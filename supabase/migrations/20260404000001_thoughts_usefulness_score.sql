-- Add usefulness_score to thoughts table for tracking how often AI finds a thought useful
alter table public.thoughts
  add column usefulness_score integer not null default 0;

-- Index for efficient sorting/filtering by usefulness
create index idx_thoughts_usefulness_score on public.thoughts (usefulness_score desc);

-- RPC function: atomically increment usefulness_score for a batch of thought IDs
create or replace function increment_usefulness(thought_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
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
