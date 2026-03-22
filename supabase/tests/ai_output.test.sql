BEGIN;
SELECT plan(8);

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

-- ─── 3.7 Partial index exists ───────────────────────────────────────────────

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'ai_output'
      AND indexname = 'ai_output_picked_up_idx'
      AND indexdef LIKE '%WHERE (picked_up = false)%'
  ),
  'Partial index ai_output_picked_up_idx exists with WHERE picked_up = false'
);

SELECT * FROM finish();
ROLLBACK;
