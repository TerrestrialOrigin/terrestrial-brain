-- RLS / privilege denial suite (change: pgtap-denial-suite — SQL-5).
--
-- The project's actual shipped bug was an RLS policy that silently granted the
-- anon key full access to `people`. These tests assert the opposite posture
-- generically: neither `anon` nor `authenticated` can read or write any brain
-- table, nor execute any RPC, and every `public` policy is scoped to
-- `service_role` only. A future migration that re-grants anon DML, drops a
-- table's revoke, or ships a policy without its `to service_role` clause turns
-- this suite red.
--
-- Denial is asserted at the privilege level: with table DML and function
-- EXECUTE revoked from anon/authenticated (20260704000001), every attempt fails
-- with SQLSTATE 42501 (insufficient_privilege), which is checked before any
-- constraint — so `INSERT ... DEFAULT VALUES` is a sufficient, uniform probe.
--
-- Keep the table list in sync with:
--   SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
-- Keep the RPC list in sync with (excluding the update_updated_at trigger fn):
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' ORDER BY p.proname;

BEGIN;
SELECT plan(51);

-- ─── Meta-assertion: every public policy is scoped to service_role ───────────
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND roles <> '{service_role}'),
  0,
  'Every public-schema policy is scoped to service_role only (no missing `to` clause)'
);

-- ─── Per-table denial: anon ─────────────────────────────────────────────────
SET LOCAL ROLE anon;

SELECT throws_ok('SELECT 1 FROM public.thoughts',            '42501', NULL, 'anon cannot SELECT thoughts');
SELECT throws_ok('INSERT INTO public.thoughts DEFAULT VALUES',        '42501', NULL, 'anon cannot INSERT thoughts');
SELECT throws_ok('SELECT 1 FROM public.projects',           '42501', NULL, 'anon cannot SELECT projects');
SELECT throws_ok('INSERT INTO public.projects DEFAULT VALUES',       '42501', NULL, 'anon cannot INSERT projects');
SELECT throws_ok('SELECT 1 FROM public.tasks',              '42501', NULL, 'anon cannot SELECT tasks');
SELECT throws_ok('INSERT INTO public.tasks DEFAULT VALUES',          '42501', NULL, 'anon cannot INSERT tasks');
SELECT throws_ok('SELECT 1 FROM public.note_snapshots',     '42501', NULL, 'anon cannot SELECT note_snapshots');
SELECT throws_ok('INSERT INTO public.note_snapshots DEFAULT VALUES', '42501', NULL, 'anon cannot INSERT note_snapshots');
SELECT throws_ok('SELECT 1 FROM public.ai_output',          '42501', NULL, 'anon cannot SELECT ai_output');
SELECT throws_ok('INSERT INTO public.ai_output DEFAULT VALUES',      '42501', NULL, 'anon cannot INSERT ai_output');
SELECT throws_ok('SELECT 1 FROM public.people',             '42501', NULL, 'anon cannot SELECT people');
SELECT throws_ok('INSERT INTO public.people DEFAULT VALUES',         '42501', NULL, 'anon cannot INSERT people');
SELECT throws_ok('SELECT 1 FROM public.documents',          '42501', NULL, 'anon cannot SELECT documents');
SELECT throws_ok('INSERT INTO public.documents DEFAULT VALUES',      '42501', NULL, 'anon cannot INSERT documents');
SELECT throws_ok('SELECT 1 FROM public.function_call_logs', '42501', NULL, 'anon cannot SELECT function_call_logs');
SELECT throws_ok('INSERT INTO public.function_call_logs DEFAULT VALUES', '42501', NULL, 'anon cannot INSERT function_call_logs');

RESET ROLE;

-- ─── Per-table denial: authenticated ────────────────────────────────────────
SET LOCAL ROLE authenticated;

SELECT throws_ok('SELECT 1 FROM public.thoughts',            '42501', NULL, 'authenticated cannot SELECT thoughts');
SELECT throws_ok('INSERT INTO public.thoughts DEFAULT VALUES',        '42501', NULL, 'authenticated cannot INSERT thoughts');
SELECT throws_ok('SELECT 1 FROM public.projects',           '42501', NULL, 'authenticated cannot SELECT projects');
SELECT throws_ok('INSERT INTO public.projects DEFAULT VALUES',       '42501', NULL, 'authenticated cannot INSERT projects');
SELECT throws_ok('SELECT 1 FROM public.tasks',              '42501', NULL, 'authenticated cannot SELECT tasks');
SELECT throws_ok('INSERT INTO public.tasks DEFAULT VALUES',          '42501', NULL, 'authenticated cannot INSERT tasks');
SELECT throws_ok('SELECT 1 FROM public.note_snapshots',     '42501', NULL, 'authenticated cannot SELECT note_snapshots');
SELECT throws_ok('INSERT INTO public.note_snapshots DEFAULT VALUES', '42501', NULL, 'authenticated cannot INSERT note_snapshots');
SELECT throws_ok('SELECT 1 FROM public.ai_output',          '42501', NULL, 'authenticated cannot SELECT ai_output');
SELECT throws_ok('INSERT INTO public.ai_output DEFAULT VALUES',      '42501', NULL, 'authenticated cannot INSERT ai_output');
SELECT throws_ok('SELECT 1 FROM public.people',             '42501', NULL, 'authenticated cannot SELECT people');
SELECT throws_ok('INSERT INTO public.people DEFAULT VALUES',         '42501', NULL, 'authenticated cannot INSERT people');
SELECT throws_ok('SELECT 1 FROM public.documents',          '42501', NULL, 'authenticated cannot SELECT documents');
SELECT throws_ok('INSERT INTO public.documents DEFAULT VALUES',      '42501', NULL, 'authenticated cannot INSERT documents');
SELECT throws_ok('SELECT 1 FROM public.function_call_logs', '42501', NULL, 'authenticated cannot SELECT function_call_logs');
SELECT throws_ok('INSERT INTO public.function_call_logs DEFAULT VALUES', '42501', NULL, 'authenticated cannot INSERT function_call_logs');

RESET ROLE;

-- ─── Per-RPC EXECUTE denial: anon ───────────────────────────────────────────
SET LOCAL ROLE anon;

SELECT throws_ok(
  'SELECT public.search_thoughts_by_embedding(NULL::extensions.vector(1536), NULL::float8, NULL::int, NULL::jsonb, NULL::text, NULL::text)',
  '42501', NULL, 'anon cannot EXECUTE search_thoughts_by_embedding');
SELECT throws_ok('SELECT public.thought_stats(NULL::uuid)',                   '42501', NULL, 'anon cannot EXECUTE thought_stats');
SELECT throws_ok('SELECT public.increment_usefulness(NULL::uuid[])',          '42501', NULL, 'anon cannot EXECUTE increment_usefulness');
SELECT throws_ok('SELECT public.increment_usefulness_weighted(NULL::uuid[], NULL::int)', '42501', NULL, 'anon cannot EXECUTE increment_usefulness_weighted');
SELECT throws_ok('SELECT public.purge_function_call_logs(NULL::int)',         '42501', NULL, 'anon cannot EXECUTE purge_function_call_logs');
SELECT throws_ok('SELECT public.get_pending_ai_output_metadata()',           '42501', NULL, 'anon cannot EXECUTE get_pending_ai_output_metadata');
SELECT throws_ok('SELECT public.normalize_thought_project_refs(NULL::uuid)',  '42501', NULL, 'anon cannot EXECUTE normalize_thought_project_refs');
SELECT throws_ok('SELECT public.count_archived_rows(NULL::text, NULL::date)', '42501', NULL, 'anon cannot EXECUTE count_archived_rows');
SELECT throws_ok('SELECT public.purge_archived_rows(NULL::text, NULL::date)', '42501', NULL, 'anon cannot EXECUTE purge_archived_rows');

RESET ROLE;

-- ─── Per-RPC EXECUTE denial: authenticated ──────────────────────────────────
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  'SELECT public.search_thoughts_by_embedding(NULL::extensions.vector(1536), NULL::float8, NULL::int, NULL::jsonb, NULL::text, NULL::text)',
  '42501', NULL, 'authenticated cannot EXECUTE search_thoughts_by_embedding');
SELECT throws_ok('SELECT public.thought_stats(NULL::uuid)',                   '42501', NULL, 'authenticated cannot EXECUTE thought_stats');
SELECT throws_ok('SELECT public.increment_usefulness(NULL::uuid[])',          '42501', NULL, 'authenticated cannot EXECUTE increment_usefulness');
SELECT throws_ok('SELECT public.increment_usefulness_weighted(NULL::uuid[], NULL::int)', '42501', NULL, 'authenticated cannot EXECUTE increment_usefulness_weighted');
SELECT throws_ok('SELECT public.purge_function_call_logs(NULL::int)',         '42501', NULL, 'authenticated cannot EXECUTE purge_function_call_logs');
SELECT throws_ok('SELECT public.get_pending_ai_output_metadata()',           '42501', NULL, 'authenticated cannot EXECUTE get_pending_ai_output_metadata');
SELECT throws_ok('SELECT public.normalize_thought_project_refs(NULL::uuid)',  '42501', NULL, 'authenticated cannot EXECUTE normalize_thought_project_refs');
SELECT throws_ok('SELECT public.count_archived_rows(NULL::text, NULL::date)', '42501', NULL, 'authenticated cannot EXECUTE count_archived_rows');
SELECT throws_ok('SELECT public.purge_archived_rows(NULL::text, NULL::date)', '42501', NULL, 'authenticated cannot EXECUTE purge_archived_rows');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
