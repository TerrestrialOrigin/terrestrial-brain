BEGIN;
SELECT plan(8);

-- ─── Prerequisite: project for FK reference ──────────────────────────────────

INSERT INTO public.projects (id, name, type)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'Task Test Project', 'test');

-- ─── status constraint rejects invalid values ────────────────────────────────

-- Valid statuses should work
INSERT INTO public.tasks (id, content, status, project_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000010', 'Open task', 'open', 'bbbbbbbb-0000-0000-0000-000000000001');

INSERT INTO public.tasks (id, content, status, project_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000011', 'In-progress task', 'in_progress', 'bbbbbbbb-0000-0000-0000-000000000001');

INSERT INTO public.tasks (id, content, status, project_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000012', 'Done task', 'done', 'bbbbbbbb-0000-0000-0000-000000000001');

INSERT INTO public.tasks (id, content, status, project_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000013', 'Deferred task', 'deferred', 'bbbbbbbb-0000-0000-0000-000000000001');

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id IN (
    'bbbbbbbb-0000-0000-0000-000000000010',
    'bbbbbbbb-0000-0000-0000-000000000011',
    'bbbbbbbb-0000-0000-0000-000000000012',
    'bbbbbbbb-0000-0000-0000-000000000013'
  )),
  4,
  'All four valid statuses (open, in_progress, done, deferred) are accepted'
);

-- Invalid status should fail
SELECT throws_ok(
  $$INSERT INTO public.tasks (content, status) VALUES ('Bad task', 'invalid_status')$$,
  '23514',
  NULL,
  'Invalid status value is rejected by check constraint'
);

SELECT throws_ok(
  $$INSERT INTO public.tasks (content, status) VALUES ('Bad task', 'cancelled')$$,
  '23514',
  NULL,
  'Status "cancelled" is rejected by check constraint'
);

-- ─── due_by ordering ─────────────────────────────────────────────────────────

INSERT INTO public.tasks (id, content, status, due_by)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000020', 'Due later', 'open', '2026-12-31T23:59:59Z'),
  ('bbbbbbbb-0000-0000-0000-000000000021', 'Due sooner', 'open', '2026-01-15T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000022', 'Due middle', 'open', '2026-06-15T12:00:00Z');

SELECT is(
  (SELECT id FROM public.tasks
   WHERE id IN ('bbbbbbbb-0000-0000-0000-000000000020', 'bbbbbbbb-0000-0000-0000-000000000021', 'bbbbbbbb-0000-0000-0000-000000000022')
   ORDER BY due_by ASC LIMIT 1),
  'bbbbbbbb-0000-0000-0000-000000000021'::uuid,
  'ORDER BY due_by ASC returns earliest due task first'
);

SELECT is(
  (SELECT id FROM public.tasks
   WHERE id IN ('bbbbbbbb-0000-0000-0000-000000000020', 'bbbbbbbb-0000-0000-0000-000000000021', 'bbbbbbbb-0000-0000-0000-000000000022')
   ORDER BY due_by DESC LIMIT 1),
  'bbbbbbbb-0000-0000-0000-000000000020'::uuid,
  'ORDER BY due_by DESC returns latest due task first'
);

-- ─── NULL due_by sorts after non-NULL ────────────────────────────────────────

INSERT INTO public.tasks (id, content, status)
VALUES ('bbbbbbbb-0000-0000-0000-000000000023', 'No due date', 'open');

SELECT ok(
  (SELECT due_by FROM public.tasks WHERE id = 'bbbbbbbb-0000-0000-0000-000000000023') IS NULL,
  'Task without due_by has NULL due_by'
);

-- Tasks with NULL due_by sort last with NULLS LAST
SELECT is(
  (SELECT id FROM public.tasks
   WHERE id IN ('bbbbbbbb-0000-0000-0000-000000000021', 'bbbbbbbb-0000-0000-0000-000000000023')
   ORDER BY due_by ASC NULLS LAST LIMIT 1),
  'bbbbbbbb-0000-0000-0000-000000000021'::uuid,
  'Tasks with NULL due_by sort after tasks with due dates (NULLS LAST)'
);

-- ─── parent_id self-reference for subtasks ───────────────────────────────────

INSERT INTO public.tasks (id, content, status, parent_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000030', 'Subtask', 'open', 'bbbbbbbb-0000-0000-0000-000000000010');

SELECT ok(
  EXISTS(SELECT 1 FROM public.tasks WHERE id = 'bbbbbbbb-0000-0000-0000-000000000030' AND parent_id = 'bbbbbbbb-0000-0000-0000-000000000010'),
  'Subtask references parent task via parent_id'
);

SELECT * FROM finish();
ROLLBACK;
