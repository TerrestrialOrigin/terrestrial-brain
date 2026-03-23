BEGIN;
SELECT plan(14);

-- ─── 3.5 Defaults — insert with required fields only ────────────────────────

INSERT INTO public.ai_output (id, title, content, file_path)
VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'Sprint Plan', '# Sprint Plan\n\nTasks here.', 'projects/CarChief/SprintPlan.md');

SELECT is(
  (SELECT picked_up FROM public.ai_output WHERE id = 'eeeeeeee-0000-0000-0000-000000000001'),
  false,
  'picked_up defaults to false'
);

SELECT ok(
  (SELECT picked_up_at FROM public.ai_output WHERE id = 'eeeeeeee-0000-0000-0000-000000000001') IS NULL,
  'picked_up_at defaults to NULL'
);

SELECT ok(
  (SELECT created_at FROM public.ai_output WHERE id = 'eeeeeeee-0000-0000-0000-000000000001') IS NOT NULL,
  'created_at is auto-set'
);

-- ─── 3.6 NOT NULL constraints ───────────────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.ai_output (title, content, file_path) VALUES (NULL, '# test', 'test.md')$$,
  '23502',
  NULL,
  'NULL title is rejected by NOT NULL constraint'
);

SELECT throws_ok(
  $$INSERT INTO public.ai_output (title, content, file_path) VALUES ('Test', NULL, 'test.md')$$,
  '23502',
  NULL,
  'NULL content is rejected by NOT NULL constraint'
);

SELECT throws_ok(
  $$INSERT INTO public.ai_output (title, content, file_path) VALUES ('Test', '# test', NULL)$$,
  '23502',
  NULL,
  'NULL file_path is rejected by NOT NULL constraint'
);

-- ─── Mark as picked up — no longer in unpicked filter ───────────────────────

UPDATE public.ai_output
SET picked_up = true, picked_up_at = now()
WHERE id = 'eeeeeeee-0000-0000-0000-000000000001';

SELECT ok(
  NOT EXISTS(SELECT 1 FROM public.ai_output WHERE id = 'eeeeeeee-0000-0000-0000-000000000001' AND picked_up = false),
  'After marking picked_up = true, row no longer in picked_up = false filter'
);

-- ─── Partial index exists (updated: now includes rejected filter) ────────────

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'ai_output'
      AND indexname = 'ai_output_pending_idx'
      AND indexdef LIKE '%picked_up = false%'
      AND indexdef LIKE '%rejected = false%'
  ),
  'Partial index ai_output_pending_idx exists with WHERE picked_up = false AND rejected = false'
);

-- ─── Rejection columns — defaults ──────────────────────────────────────────

INSERT INTO public.ai_output (id, title, content, file_path)
VALUES ('eeeeeeee-0000-0000-0000-000000000002', 'Test Reject', '# Reject Test', 'test/reject.md');

SELECT is(
  (SELECT rejected FROM public.ai_output WHERE id = 'eeeeeeee-0000-0000-0000-000000000002'),
  false,
  'rejected defaults to false'
);

SELECT ok(
  (SELECT rejected_at FROM public.ai_output WHERE id = 'eeeeeeee-0000-0000-0000-000000000002') IS NULL,
  'rejected_at defaults to NULL'
);

-- ─── Rejection — row excluded from pending filter ──────────────────────────

UPDATE public.ai_output
SET rejected = true, rejected_at = now()
WHERE id = 'eeeeeeee-0000-0000-0000-000000000002';

SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM public.ai_output
    WHERE id = 'eeeeeeee-0000-0000-0000-000000000002'
      AND picked_up = false
      AND rejected = false
  ),
  'After rejecting, row no longer in pending filter (picked_up = false AND rejected = false)'
);

-- ─── Rejected row still exists in table ────────────────────────────────────

SELECT ok(
  EXISTS(
    SELECT 1 FROM public.ai_output
    WHERE id = 'eeeeeeee-0000-0000-0000-000000000002'
      AND rejected = true
  ),
  'Rejected row is preserved in table (not deleted)'
);

SELECT ok(
  (SELECT rejected_at FROM public.ai_output WHERE id = 'eeeeeeee-0000-0000-0000-000000000002') IS NOT NULL,
  'rejected_at is set after rejection'
);

-- ─── Pending filter: only non-picked-up, non-rejected rows ────────────────

INSERT INTO public.ai_output (id, title, content, file_path)
VALUES ('eeeeeeee-0000-0000-0000-000000000003', 'Pending Note', '# Pending', 'test/pending.md');

SELECT ok(
  EXISTS(
    SELECT 1 FROM public.ai_output
    WHERE id = 'eeeeeeee-0000-0000-0000-000000000003'
      AND picked_up = false
      AND rejected = false
  ),
  'Non-rejected, non-picked-up row appears in pending filter'
);

SELECT * FROM finish();
ROLLBACK;
