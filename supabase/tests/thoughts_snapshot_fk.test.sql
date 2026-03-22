BEGIN;
SELECT plan(5);

-- ─── Setup: create a note snapshot ──────────────────────────────────────────

INSERT INTO public.note_snapshots (id, reference_id, content)
VALUES ('dddddddd-0000-0000-0000-000000000010', 'test/fk-test.md', 'FK test content');

-- ─── 3.3 Nullable FK — NULL snapshot_id succeeds ────────────────────────────

INSERT INTO public.thoughts (id, content, note_snapshot_id)
VALUES ('ffffffff-0000-0000-0000-000000000001', 'Thought without snapshot', NULL);

SELECT ok(
  EXISTS(SELECT 1 FROM public.thoughts WHERE id = 'ffffffff-0000-0000-0000-000000000001' AND note_snapshot_id IS NULL),
  'Thought with NULL note_snapshot_id is accepted'
);

-- ─── 3.3 Valid snapshot_id succeeds ─────────────────────────────────────────

INSERT INTO public.thoughts (id, content, note_snapshot_id)
VALUES ('ffffffff-0000-0000-0000-000000000002', 'Thought with snapshot', 'dddddddd-0000-0000-0000-000000000010');

SELECT ok(
  EXISTS(SELECT 1 FROM public.thoughts WHERE id = 'ffffffff-0000-0000-0000-000000000002' AND note_snapshot_id = 'dddddddd-0000-0000-0000-000000000010'),
  'Thought with valid note_snapshot_id is accepted'
);

-- ─── 3.3 Invalid snapshot_id fails ──────────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.thoughts (content, note_snapshot_id) VALUES ('Bad ref', 'aaaaaaaa-0000-0000-0000-000000000099')$$,
  '23503',
  NULL,
  'Thought with non-existent note_snapshot_id is rejected by FK constraint'
);

-- ─── 3.4 ON DELETE SET NULL ─────────────────────────────────────────────────

-- Confirm the thought currently references the snapshot
SELECT is(
  (SELECT note_snapshot_id FROM public.thoughts WHERE id = 'ffffffff-0000-0000-0000-000000000002'),
  'dddddddd-0000-0000-0000-000000000010'::uuid,
  'Before delete: thought references the snapshot'
);

-- Delete the snapshot
DELETE FROM public.note_snapshots WHERE id = 'dddddddd-0000-0000-0000-000000000010';

-- Thought should still exist with NULL snapshot_id
SELECT ok(
  EXISTS(SELECT 1 FROM public.thoughts WHERE id = 'ffffffff-0000-0000-0000-000000000002' AND note_snapshot_id IS NULL),
  'After snapshot delete: thought still exists with note_snapshot_id set to NULL'
);

SELECT * FROM finish();
ROLLBACK;
