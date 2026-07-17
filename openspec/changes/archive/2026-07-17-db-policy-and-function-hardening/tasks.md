## 1. Reproduce (tests first — must fail RED)

- [x] 1.1 Add an integration test asserting `increment_usefulness_weighted` rejects `weight` of 0, 101, and a negative value (RPC raises; seeded thought's `usefulness_score` unchanged) — confirm it fails RED against current code (current function accepts any int).
- [x] 1.2 Add an integration test asserting a valid `weight` (e.g. 3) increases a seeded thought's `usefulness_score` by exactly that weight.
- [x] 1.3 Add an anon-denial behavioral test asserting the anon key cannot read `function_call_logs` (extends TEST-8-style coverage to this personal-data table). Verify the `function_call_logs` policy shape (`roles = {service_role}`) via `docker exec psql` during the gate as evidence (pg_catalog is not REST-exposed; the generic `pg_policies` meta-assertion is deferred to Step 10's pgTAP suite per SQL-1 fix step 3). Confirm RED before the migration: `pg_policies` currently shows `roles = {public}`.

## 2. Migration (append-only)

- [x] 2.1 Create `supabase/migrations/20260717000002_db_policy_and_function_hardening.sql` with a header comment referencing the change and SQL-1/SQL-4/SQL-8.
- [x] 2.2 SQL-1: `drop policy "Service role full access" on public.function_call_logs;` then recreate as `create policy "Service role full access on function_call_logs" on public.function_call_logs for all to service_role using (true) with check (true);`.
- [x] 2.3 SQL-4: `create or replace function public.increment_usefulness(uuid[])` (body unchanged) with `set search_path = public, pg_temp`; restate `revoke execute … from public, anon, authenticated;` and `grant execute … to service_role;`.
- [x] 2.4 SQL-4: `create or replace function public.update_updated_at()` (trigger body unchanged) with `set search_path = public, pg_temp` (no grant lines — trigger function).
- [x] 2.5 SQL-4 + SQL-8: `create or replace function public.increment_usefulness_weighted(uuid[], int)` with `set search_path = public, pg_temp`, adding the guard `if weight < 1 or weight > 100 then raise exception 'weight must be between 1 and 100, got %', weight; end if;` at the top; restate the revoke/grant execute lines.

## 3. Verify GREEN

- [x] 3.1 `npx supabase db reset` to apply the new migration to a fresh stack.
- [x] 3.2 Run the new integration tests — confirm they now pass; confirm GATE 2b (removing the guard / reverting the policy reddens them).
- [x] 3.3 Run the full Deno suite (`deno task test`) against the reset stack — zero failures, zero skips.
- [x] 3.4 Run `cd obsidian-plugin && npm test && npm run build` (no plugin change expected; confirm still green).
- [x] 3.5 Run `scripts/validate-all.sh` / `npm run validate` — zero failures.

## 4. Finalize

- [x] 4.1 `/opsx:verify` then `/opsx:archive`.
- [x] 4.2 Check off Step 9 in `codeEval/Fable20260717RemediationPlan.md` Progress Checklist.
- [ ] 4.3 Commit and open PR to `develop` (do not delete the branch).
