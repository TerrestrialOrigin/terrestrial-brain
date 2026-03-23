-- Enable Row Level Security on all public tables.
-- Access is restricted to the service_role (used by edge functions and the Obsidian plugin).
-- The anon/publishable key has no access.

-- ─── thoughts ──────────────────────────────────────────────────────────────────
alter table public.thoughts enable row level security;

create policy "Service role full access on thoughts"
  on public.thoughts
  for all
  to service_role
  using (true)
  with check (true);

-- ─── projects ──────────────────────────────────────────────────────────────────
alter table public.projects enable row level security;

create policy "Service role full access on projects"
  on public.projects
  for all
  to service_role
  using (true)
  with check (true);

-- ─── tasks ─────────────────────────────────────────────────────────────────────
alter table public.tasks enable row level security;

create policy "Service role full access on tasks"
  on public.tasks
  for all
  to service_role
  using (true)
  with check (true);

-- ─── note_snapshots ────────────────────────────────────────────────────────────
alter table public.note_snapshots enable row level security;

create policy "Service role full access on note_snapshots"
  on public.note_snapshots
  for all
  to service_role
  using (true)
  with check (true);

-- ─── ai_output ─────────────────────────────────────────────────────────────────
alter table public.ai_output enable row level security;

create policy "Service role full access on ai_output"
  on public.ai_output
  for all
  to service_role
  using (true)
  with check (true);
