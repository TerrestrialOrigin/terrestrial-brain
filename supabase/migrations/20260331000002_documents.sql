-- Documents table: full long-form reference material linked to projects
create table public.documents (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  content text not null,
  file_path text null,                       -- optional vault-relative path for provenance
  "references" jsonb not null default '{"people": [], "tasks": []}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_pkey primary key (id)
);

-- Indexes
create index idx_documents_project_id on public.documents (project_id);

-- Auto-update updated_at
create trigger update_documents_updated_at
  before update on public.documents
  for each row execute function update_updated_at();

-- Enable RLS (consistent with other tables)
alter table public.documents enable row level security;
create policy "Service role full access on documents" on public.documents
  for all
  to service_role
  using (true)
  with check (true);
