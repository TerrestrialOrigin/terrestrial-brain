create table public.tasks (
  id uuid not null default gen_random_uuid(),
  content text not null,
  status text not null default 'open',     -- open, in_progress, done, deferred
  due_by timestamptz null,
  project_id uuid null references public.projects(id) on delete set null,
  parent_id uuid null references public.tasks(id) on delete set null,
  metadata jsonb null default '{}',
  archived_at timestamptz null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  constraint tasks_pkey primary key (id),
  constraint tasks_status_check check (status in ('open', 'in_progress', 'done', 'deferred'))
);

create index tasks_project_id_idx on public.tasks using btree (project_id);
create index tasks_parent_id_idx on public.tasks using btree (parent_id);
create index tasks_status_idx on public.tasks using btree (status);
create index tasks_due_by_idx on public.tasks using btree (due_by);
create index tasks_archived_at_idx on public.tasks using btree (archived_at);

create trigger tasks_updated_at
  before update on tasks
  for each row execute function update_updated_at();
