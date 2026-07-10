-- Add a bounded, content-free record of WHICH entity ids a retrieval call
-- returned (New-Feature-Plan Step 2b). Nullable: only thought-retrieval reads
-- (search_thoughts / list_thoughts / get_thought_by_id) populate it; every
-- other call and all historical rows stay NULL. Stores ids only — never
-- thought/note content — so it adds no new personal-content surface and is
-- purged by the same retention window as the rest of the row. Precursor to the
-- Step 7 last_retrieved_at retrieval signal. Append-only (docs/upgrade.md).
alter table function_call_logs
  add column returned_ids jsonb;
