BEGIN;
SELECT plan(7);

-- ─── 3.1 Upsert on reference_id ────────────────────────────────────────────

INSERT INTO public.note_snapshots (id, reference_id, title, content, source)
VALUES ('dddddddd-0000-0000-0000-000000000001', 'projects/CarChief/planning.md', 'Planning', 'Original content', 'obsidian');

SELECT is(
  (SELECT count(*)::int FROM public.note_snapshots WHERE reference_id = 'projects/CarChief/planning.md'),
  1,
  'Initial insert creates one row'
);

INSERT INTO public.note_snapshots (reference_id, title, content, source)
VALUES ('projects/CarChief/planning.md', 'Planning v2', 'Updated content', 'obsidian')
ON CONFLICT (reference_id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  captured_at = now();

SELECT is(
  (SELECT count(*)::int FROM public.note_snapshots WHERE reference_id = 'projects/CarChief/planning.md'),
  1,
  'Upsert does not create duplicate — still one row'
);

SELECT is(
  (SELECT content FROM public.note_snapshots WHERE reference_id = 'projects/CarChief/planning.md'),
  'Updated content',
  'Upsert updated the content to new value'
);

SELECT is(
  (SELECT title FROM public.note_snapshots WHERE reference_id = 'projects/CarChief/planning.md'),
  'Planning v2',
  'Upsert updated the title to new value'
);

-- ─── 3.2 NOT NULL constraint on content ─────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.note_snapshots (reference_id, content) VALUES ('test/null-content.md', NULL)$$,
  '23502',
  NULL,
  'NULL content is rejected by NOT NULL constraint'
);

-- ─── Unique constraint on reference_id (plain INSERT) ───────────────────────

SELECT throws_ok(
  $$INSERT INTO public.note_snapshots (reference_id, content) VALUES ('projects/CarChief/planning.md', 'Duplicate ref')$$,
  '23505',
  NULL,
  'Duplicate reference_id is rejected by unique constraint'
);

-- ─── Defaults ───────────────────────────────────────────────────────────────

INSERT INTO public.note_snapshots (reference_id, content)
VALUES ('test/defaults.md', 'Test defaults');

SELECT is(
  (SELECT source FROM public.note_snapshots WHERE reference_id = 'test/defaults.md'),
  'obsidian',
  'Source defaults to obsidian'
);

SELECT * FROM finish();
ROLLBACK;
