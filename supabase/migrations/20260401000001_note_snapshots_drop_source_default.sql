-- Remove the default value from note_snapshots.source and make it nullable.
-- Obsidian plugin path passes 'obsidian' explicitly; other callers may pass a value or leave it null.
ALTER TABLE note_snapshots ALTER COLUMN source DROP DEFAULT;
ALTER TABLE note_snapshots ALTER COLUMN source DROP NOT NULL;
