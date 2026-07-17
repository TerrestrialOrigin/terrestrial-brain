## Why

The project's actual shipped bug was an RLS policy that silently granted the anon key full access to `people`. Yet the DB-level regression net has two holes that would let that class recur unnoticed: the six pgTAP files contain **zero denial tests** (all run as the migration superuser, happy-path only), and no pipeline runs `supabase test db` at all — so a migration that re-grants anon DML or ships a policy without its `to` clause goes red nowhere. The Deno anon-denial coverage is likewise partial: it asserts denial only for `people` and one RPC, while claiming to lock anon out of "ALL brain data."

## What Changes

- Add `supabase/tests/rls_denial.test.sql`: for every `public` table (`thoughts`, `projects`, `tasks`, `note_snapshots`, `ai_output`, `people`, `documents`, `function_call_logs`) assert `anon` and `authenticated` are denied `SELECT` and `INSERT` (SQLSTATE `42501`); for every exposed RPC assert `EXECUTE` is denied to `anon`/`authenticated`; and a meta-assertion that every `pg_policies` row for schema `public` has `roles = {service_role}` (catches the missing-`to` class generically).
- Wire `npx supabase test db` into `scripts/validate-all.sh` (after the stack-reachability check) and into `.github/workflows/ci.yml` (a `pgTAP database tests` step between "Start Supabase stack" and the Deno tests).
- Extend the Deno integration denial coverage (`tests/integration/db_access_control.test.ts`): a parameterized `assertAnonDenied` helper looped over every brain-data table, plus an anon-denial probe per exposed RPC.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `database-access-control`: anon/authenticated denial SHALL be asserted for **every** `public` table and **every** exposed RPC (not just `people`/`increment_usefulness`), at both the pgTAP and Deno integration layers, plus a generic `pg_policies` scope meta-assertion.
- `test-infrastructure`: a pgTAP database-test suite SHALL exist and include RLS denial coverage and the policy-scope meta-assertion.
- `developer-workflow`: both the validation script and CI SHALL run `supabase test db` so DB-level regressions fail the pipeline.

## Non-goals

- Changing any policy or grant (Step 9 already normalized them; this step only asserts the posture).
- Port-offset / stack-reset hygiene in the scripts (Step 14) — this step only adds the `supabase test db` invocation.
- Editing the stale "RED-BY-DESIGN until Step 7" CI comment (SCRIPT-5, owned by Step 14).

## Impact

- `supabase/tests/rls_denial.test.sql` (new), `scripts/validate-all.sh`, `.github/workflows/ci.yml`, `tests/integration/db_access_control.test.ts`.
- Affected spec files: `openspec/specs/database-access-control/spec.md`, `openspec/specs/test-infrastructure/spec.md`, `openspec/specs/developer-workflow/spec.md`.
