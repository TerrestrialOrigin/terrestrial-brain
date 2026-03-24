-- People table: first-class person entities (human or AI)
create table public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text check (type in ('human', 'ai')),
  email text,
  description text,
  metadata jsonb not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index idx_people_type on public.people (type);
create index idx_people_archived_at on public.people (archived_at);

-- Auto-update updated_at
create trigger update_people_updated_at
  before update on public.people
  for each row execute function update_updated_at();

-- Enable RLS (consistent with other tables)
alter table public.people enable row level security;
create policy "Allow all for service role" on public.people
  for all using (true) with check (true);
