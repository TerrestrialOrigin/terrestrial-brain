-- Sprint 1: Database Migrations
-- Creates note_snapshots and ai_output tables, adds thoughts.note_snapshot_id FK

-- ─── note_snapshots ─────────────────────────────────────────────────────────

create table public.note_snapshots (
  id uuid not null default gen_random_uuid(),
  reference_id text not null unique,
  title text null,
  content text not null,
  source text not null default 'obsidian',
  captured_at timestamptz not null default now(),
  constraint note_snapshots_pkey primary key (id)
);

create index note_snapshots_reference_id_idx on public.note_snapshots using btree (reference_id);
create index note_snapshots_source_idx on public.note_snapshots using btree (source);

-- ─── ai_output ──────────────────────────────────────────────────────────────

create table public.ai_output (
  id uuid not null default gen_random_uuid(),
  title text not null,
  content text not null,
  file_path text not null,
  source_context text null,
  created_at timestamptz not null default now(),
  picked_up boolean not null default false,
  picked_up_at timestamptz null,
  constraint ai_output_pkey primary key (id)
);

create index ai_output_picked_up_idx on public.ai_output using btree (picked_up) where picked_up = false;

-- ─── thoughts.note_snapshot_id ──────────────────────────────────────────────

alter table public.thoughts
  add column note_snapshot_id uuid null references public.note_snapshots(id) on delete set null;

create index thoughts_note_snapshot_id_idx on public.thoughts using btree (note_snapshot_id);
