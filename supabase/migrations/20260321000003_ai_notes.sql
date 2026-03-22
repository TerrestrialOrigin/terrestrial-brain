create table public.ai_notes (
  id uuid not null default gen_random_uuid(),
  title text not null,
  content text not null,                   -- full markdown content including frontmatter
  suggested_path text null,                -- e.g. "AI Notes/CarChief/analysis.md"
  created_at_utc bigint not null,          -- UTC milliseconds
  synced_at bigint null,                   -- null = not yet pulled by Obsidian plugin
  constraint ai_notes_pkey primary key (id)
);

create index ai_notes_synced_at_idx on public.ai_notes using btree (synced_at);
create index ai_notes_created_at_utc_idx on public.ai_notes using btree (created_at_utc desc);
