## 1. Database Migration

- [x] 1.1 Create migration file `supabase/migrations/<timestamp>_create_note_snapshots_ai_output.sql` with: `note_snapshots` table (id, reference_id UNIQUE, title, content, source, captured_at), indexes on reference_id and source
- [x] 1.2 Add `ai_output` table (id, title, content, file_path, source_context, created_at, picked_up, picked_up_at) with partial index on `picked_up WHERE picked_up = false` to the same migration file
- [x] 1.3 Add `ALTER TABLE thoughts ADD COLUMN note_snapshot_id uuid NULL REFERENCES note_snapshots(id) ON DELETE SET NULL` and btree index on `note_snapshot_id` to the same migration file

## 2. Apply and Validate Migration

- [x] 2.1 Run `supabase db reset` to apply the migration locally and verify no SQL errors
- [x] 2.2 Verify tables exist and columns/constraints match specs by querying `information_schema`

## 3. Testing & Verification

- [x] 3.1 Write pgTAP test: `note_snapshots` upsert on `reference_id` — insert, then upsert, verify only one row exists with updated content
- [x] 3.2 Write pgTAP test: `note_snapshots` NOT NULL constraint on `content` — insert with NULL content fails
- [x] 3.3 Write pgTAP test: `thoughts.note_snapshot_id` nullable FK — insert thought with NULL snapshot_id succeeds, insert with valid snapshot_id succeeds, insert with invalid snapshot_id fails
- [x] 3.4 Write pgTAP test: `ON DELETE SET NULL` — delete a note_snapshot row, verify linked thoughts have `note_snapshot_id` set to NULL
- [x] 3.5 Write pgTAP test: `ai_output` defaults — insert with only required fields, verify `picked_up = false`, `picked_up_at IS NULL`, `created_at` is set
- [x] 3.6 Write pgTAP test: `ai_output` NOT NULL constraints — title, content, file_path cannot be NULL
- [x] 3.7 Write pgTAP test: `ai_output` partial index — verify index exists and filters on `picked_up = false`
- [x] 3.8 Run all pgTAP tests and verify 0 failures, 0 skips
