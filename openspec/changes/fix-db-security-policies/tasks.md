# Tasks: fix-db-security-policies

## 1. Replication tests (write FAILING tests first — bug-fix rule)

- [x] 1.1 Start the local stack (`npx supabase start`) and capture the local anon key and service-role key for test use (same source the existing integration tests use for the service-role key)
- [x] 1.2 Create `tests/integration/db_access_control.test.ts` with anon-key **denial** tests per `test-plan.md`: people SELECT, INSERT, UPDATE, DELETE (rejected with 42501, no state change verified via service role), and `increment_usefulness` RPC (permission denied, score unchanged). Each test seeds its own uniquely-named fixtures via the service role and cleans up in `try/finally`
- [x] 1.3 Add service-role **regression** assertions in the same file: people CRUD via service role succeeds; service-role `increment_usefulness` RPC increments a seeded thought's score by exactly 1
- [x] 1.4 Run the new file and confirm the denial tests FAIL against the current schema (anon access currently succeeds) while the regression tests pass — this replicates findings S1 and S3. CONFIRMED: 5 denial tests failed pre-fix (anon had full people CRUD and the RPC returned 200 with 1 row incremented); 2 service-role regression tests passed

## 2. Migration (the fix)

- [x] 2.1 Create new append-only migration `supabase/migrations/20260704000001_fix_db_security_policies.sql` (never edit existing migrations): drop policy `"Allow all for service role"` on `public.people` and create `"Service role full access on people"` `for all to service_role using (true) with check (true)` (canonical shape from `20260322000004_enable_rls.sql`)
- [x] 2.2 In the same migration, make privileges explicit instead of default-dependent (implementation discovery — see design D10): grant table DML and function EXECUTE to `service_role`; revoke table DML and function EXECUTE from `public`/`anon`/`authenticated` (covers `increment_usefulness` and all current/future public-schema functions via `alter default privileges`)
- [x] 2.3 Apply locally (`npx supabase db reset`) and confirm the migration applies cleanly from a blank slate — confirmed
- [x] 2.4 Re-run `tests/integration/db_access_control.test.ts` — all 7 tests pass (5 denial + 2 regression)

## 3. Documentation & threat model

- [x] 3.1 Create `docs/ThreatModel.md` with the threats and mitigations from design.md D7 (T1 PII exfiltration via anon key, T2 ranking poisoning via anon RPC, T3 future SECURITY DEFINER regression), including the standing rule: every future `security definer` function must `revoke execute ... from public` in its creating migration
- [x] 3.2 Check off Step 1 in the checklist at the bottom of `codeEval/Fable20260704-fix-plan.md`

## 4. Testing & Verification

- [x] 4.1 Run the full Deno suite with the local stack up: `deno test --allow-net --allow-env tests/` — 326 passed, 0 failed, 0 skipped
- [x] 4.2 Run the plugin suite and build: `cd obsidian-plugin && npm test && npm run build` — 56 passed, 0 failed, 0 skipped, clean production build
- [x] 4.3 Walk each scenario in `specs/database-access-control/spec.md` and confirm the implementation and a test cover it — policy shape and function ACLs additionally verified directly via `pg_policy`/`pg_proc` queries
- [x] 4.4 Run `openspec validate fix-db-security-policies` (this CLI's verify) — change is valid; archive (`/opsx:archive`) to run together with the commit step below
- [ ] 4.5 Commit on `bug/DbSecurityPolicies` and open a PR to `develop` (do NOT delete the branch; do NOT commit before the user asks)
