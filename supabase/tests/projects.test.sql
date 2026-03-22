BEGIN;
SELECT plan(8);

-- ─── parent_id self-reference ────────────────────────────────────────────────

-- Insert a parent project
INSERT INTO public.projects (id, name, type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'pgTAP Parent', 'test');

-- Insert a child referencing the parent
INSERT INTO public.projects (id, name, type, parent_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'pgTAP Child', 'test', 'aaaaaaaa-0000-0000-0000-000000000001');

SELECT ok(
  EXISTS(SELECT 1 FROM public.projects WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002' AND parent_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Child project references parent via parent_id'
);

SELECT is(
  (SELECT name FROM public.projects WHERE id = (SELECT parent_id FROM public.projects WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002')),
  'pgTAP Parent',
  'Following parent_id resolves to the correct parent'
);

-- Verify ON DELETE SET NULL behavior
DELETE FROM public.projects WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

SELECT is(
  (SELECT parent_id FROM public.projects WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  NULL,
  'Deleting parent sets child parent_id to NULL (ON DELETE SET NULL)'
);

-- ─── archived_at filtering ───────────────────────────────────────────────────

-- Insert active and archived projects
INSERT INTO public.projects (id, name, type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 'Active Project', 'test');

INSERT INTO public.projects (id, name, type, archived_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000004', 'Archived Project', 'test', now());

SELECT ok(
  EXISTS(SELECT 1 FROM public.projects WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003' AND archived_at IS NULL),
  'Active project has NULL archived_at'
);

SELECT ok(
  EXISTS(SELECT 1 FROM public.projects WHERE id = 'aaaaaaaa-0000-0000-0000-000000000004' AND archived_at IS NOT NULL),
  'Archived project has non-NULL archived_at'
);

-- Filter for active only (archived_at IS NULL)
SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000004') AND archived_at IS NULL),
  1,
  'Filtering by archived_at IS NULL returns only active projects'
);

-- Filter for all (no filter)
SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000004')),
  2,
  'Without filter, both active and archived projects are returned'
);

-- ─── updated_at trigger ──────────────────────────────────────────────────────

SELECT ok(
  (SELECT updated_at FROM public.projects WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003') IS NOT NULL,
  'updated_at is set on insert'
);

SELECT * FROM finish();
ROLLBACK;
