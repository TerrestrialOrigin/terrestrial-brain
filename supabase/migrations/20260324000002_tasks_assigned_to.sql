-- Add optional assigned_to FK from tasks to people
alter table public.tasks
  add column assigned_to uuid references public.people(id) on delete set null;

create index idx_tasks_assigned_to on public.tasks (assigned_to);
