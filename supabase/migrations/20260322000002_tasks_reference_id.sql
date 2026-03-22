-- Add reference_id column to tasks table for note-to-task traceability.
-- Stores the vault-relative path of the source note for extractor-created tasks.
-- Nullable: tasks created manually via MCP tool have no source note.

alter table public.tasks
  add column reference_id text null;

create index tasks_reference_id_idx on public.tasks using btree (reference_id);
