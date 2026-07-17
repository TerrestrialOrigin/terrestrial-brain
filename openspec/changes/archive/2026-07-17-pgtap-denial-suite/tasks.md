## 1. pgTAP denial suite (SQL-5)

- [x] 1.1 Create `supabase/tests/rls_denial.test.sql` with `BEGIN; SELECT plan(N);` … `SELECT * FROM finish(); ROLLBACK;`.
- [x] 1.2 Meta-assertion: `is((select count(*)::int from pg_policies where schemaname='public' and roles <> '{service_role}'), 0, …)`.
- [x] 1.3 Per table (8): `SET LOCAL ROLE anon;` then `throws_ok('SELECT 1 FROM public.<t>', '42501', NULL, …)` and `throws_ok('INSERT INTO public.<t> DEFAULT VALUES', '42501', NULL, …)`; `RESET ROLE;`. Repeat for `authenticated`. Include a "keep in sync with pg_tables" comment + enumeration query.
- [x] 1.4 Per RPC (7): as `anon` and `authenticated`, `throws_ok('SELECT public.<rpc>(<null-args>)', '42501', NULL, …)`. Include the enumeration query comment.
- [x] 1.5 Run `npx supabase test db` — the new suite passes; confirm GATE 2b by temporarily granting anon SELECT on one table (reddens) and reverting.

## 2. Wire pgTAP into pipelines (SQL-6)

- [x] 2.1 In `scripts/validate-all.sh`, add a `supabase test db` step (with header) after the stack-reachability check and before `deno task test`.
- [x] 2.2 In `.github/workflows/ci.yml`, add a `pgTAP database tests` step (`supabase test db`) between "Start Supabase stack" and the Deno tests. Do NOT touch the stale "RED-BY-DESIGN until Step 7" comment (Step 14 owns SCRIPT-5).

## 3. Extend Deno anon-denial coverage (TEST-8)

- [x] 3.1 In `tests/integration/db_access_control.test.ts`, add a parameterized `assertAnonDenied(table, seedRow)` helper and loop it over every brain-data table (SELECT denial; INSERT denial where a seed row is meaningful).
- [x] 3.2 Add an anon-denial EXECUTE probe per exposed RPC not already covered.
- [x] 3.3 Confirm the existing `people`/`increment_usefulness` tests still pass (no duplication regressions); refactor them onto the helper if it reduces copies without losing coverage.

## 4. Gates

- [x] 4.1 `npx supabase db reset`; run `npx supabase test db` (green) and `deno task test` (green, 0 skips).
- [x] 4.2 `cd obsidian-plugin && npm test && npm run build` (green).
- [x] 4.3 `scripts/validate-all.sh` end-to-end (now includes the pgTAP step) — green.

## 5. Finalize

- [x] 5.1 `/opsx:verify`, sync delta specs, `/opsx:archive`.
- [x] 5.2 Check off Step 10 in `codeEval/Fable20260717RemediationPlan.md`.
- [x] 5.3 Commit on branch, merge into develop, push.
