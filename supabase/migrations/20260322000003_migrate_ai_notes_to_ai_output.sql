-- Migrate unsynced ai_notes rows to ai_output, then drop ai_notes table.
-- Maps: suggested_path → file_path (with fallback), synced_at IS NULL → picked_up = false

BEGIN;

-- Migrate unsynced rows (synced_at IS NULL) as pending output
INSERT INTO public.ai_output (title, content, file_path, source_context, created_at, picked_up, picked_up_at)
SELECT
  title,
  content,
  COALESCE(suggested_path, 'AI Notes/' || title || '.md'),
  NULL,
  to_timestamp(created_at_utc / 1000.0),
  false,
  NULL
FROM public.ai_notes
WHERE synced_at IS NULL;

-- Migrate synced rows (synced_at IS NOT NULL) as already picked up
INSERT INTO public.ai_output (title, content, file_path, source_context, created_at, picked_up, picked_up_at)
SELECT
  title,
  content,
  COALESCE(suggested_path, 'AI Notes/' || title || '.md'),
  NULL,
  to_timestamp(created_at_utc / 1000.0),
  true,
  to_timestamp(synced_at / 1000.0)
FROM public.ai_notes
WHERE synced_at IS NOT NULL;

-- Drop the old table
DROP TABLE IF EXISTS public.ai_notes;

COMMIT;
