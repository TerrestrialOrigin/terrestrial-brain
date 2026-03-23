-- Add rejection tracking to ai_output table.
-- Rejected outputs are excluded from pending polls but preserved for audit.

alter table public.ai_output
  add column rejected boolean not null default false,
  add column rejected_at timestamptz null;

-- Replace the old partial index with one that also excludes rejected rows
drop index if exists public.ai_output_picked_up_idx;

create index ai_output_pending_idx
  on public.ai_output using btree (picked_up, rejected)
  where picked_up = false and rejected = false;
