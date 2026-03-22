create table public.projects (
  id uuid not null default gen_random_uuid(),
  name text not null,
  type text null,                          -- e.g. 'client', 'personal', 'research', 'internal'
  parent_id uuid null references public.projects(id) on delete set null,
  description text null,
  metadata jsonb null default '{}',
  archived_at timestamptz null,            -- null = active; stamped = archived
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  constraint projects_pkey primary key (id)
);

create index projects_parent_id_idx on public.projects using btree (parent_id);
create index projects_archived_at_idx on public.projects using btree (archived_at);

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();
