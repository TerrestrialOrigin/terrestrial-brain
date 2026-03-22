BEGIN;
SELECT plan(6);

-- ─── Insert test data ────────────────────────────────────────────────────────

INSERT INTO public.ai_notes (id, title, content, suggested_path, created_at_utc, synced_at)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'Unsynced Note 1', '# Note 1', 'AI Notes/note1.md', 1742558400000, NULL),
  ('cccccccc-0000-0000-0000-000000000002', 'Unsynced Note 2', '# Note 2', 'AI Notes/note2.md', 1742558401000, NULL),
  ('cccccccc-0000-0000-0000-000000000003', 'Synced Note', '# Note 3', 'AI Notes/note3.md', 1742558402000, 1742558500000);

-- ─── synced_at IS NULL filter returns correct rows ───────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.ai_notes
   WHERE id IN ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003')
   AND synced_at IS NULL),
  2,
  'synced_at IS NULL returns only unsynced notes'
);

SELECT is(
  (SELECT count(*)::int FROM public.ai_notes
   WHERE id IN ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003')
   AND synced_at IS NOT NULL),
  1,
  'synced_at IS NOT NULL returns only synced notes'
);

-- ─── Marking as synced removes from unsynced filter ──────────────────────────

UPDATE public.ai_notes
SET synced_at = 1742558600000
WHERE id = 'cccccccc-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.ai_notes
   WHERE id IN ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003')
   AND synced_at IS NULL),
  1,
  'After marking one note synced, only one unsynced note remains'
);

SELECT ok(
  NOT EXISTS(SELECT 1 FROM public.ai_notes WHERE id = 'cccccccc-0000-0000-0000-000000000001' AND synced_at IS NULL),
  'Marked note no longer appears in synced_at IS NULL filter'
);

-- ─── created_at_utc ordering ─────────────────────────────────────────────────

SELECT is(
  (SELECT id FROM public.ai_notes
   WHERE id IN ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003')
   ORDER BY created_at_utc DESC LIMIT 1),
  'cccccccc-0000-0000-0000-000000000003'::uuid,
  'ORDER BY created_at_utc DESC returns most recently created note first'
);

-- ─── Required fields enforcement ─────────────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.ai_notes (title, content, created_at_utc) VALUES (NULL, '# test', 1742558400000)$$,
  '23502',
  NULL,
  'NULL title is rejected by NOT NULL constraint'
);

SELECT * FROM finish();
ROLLBACK;
