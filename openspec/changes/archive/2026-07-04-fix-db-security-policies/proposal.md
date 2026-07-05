# Proposal: fix-db-security-policies

## Why

Two database objects are accessible to holders of the public anon key, bypassing the system's intended trust model (single shared `MCP_ACCESS_KEY` at the edge function, with RLS locking out `anon`):

1. The `people` table's RLS policy `"Allow all for service role"` (`supabase/migrations/20260324000001_people.sql:24-26`) has **no `to service_role` clause**, so despite its name it applies to ALL roles — including `anon` and `authenticated`, which hold Supabase's default table grants. Anyone with the project's anon key can read, write, and delete the entire `people` table (names, emails, descriptions — personal data, so this is also a GDPR exposure). Every other table's policy correctly scopes `to service_role` (e.g. `20260322000004_enable_rls.sql`).
2. `increment_usefulness(uuid[])` (`supabase/migrations/20260404000001_thoughts_usefulness_score.sql`) is `SECURITY DEFINER`, and Supabase grants `EXECUTE` on public-schema functions to `anon`/`authenticated` by default. An anon-key holder can arbitrarily inflate any thought's `usefulness_score`, bypassing RLS entirely.

This is Step 1 (finding S1, S3) of the remediation plan in `codeEval/Fable20260704-fix-plan.md`, prioritized first because it is exploitable now and the fix is small and independent.

## What Changes

- New append-only migration that:
  - Drops the `people` policy `"Allow all for service role"` and recreates it scoped `for all to service_role`.
  - Makes privileges explicit instead of environment-default-dependent (implementation discovery, design D10): grants table DML and function `EXECUTE` to `service_role`; revokes both from `public`/`anon`/`authenticated` across all `public`-schema tables and functions (which covers `increment_usefulness(uuid[])`), with matching `alter default privileges` for future objects.
- New integration tests (written FIRST, per the bug-fix replicate-before-fix rule) that use the **anon key** against the local Supabase REST API and assert denial for `people` select/insert/update/delete and for the `increment_usefulness` RPC — plus regression assertions that service-role paths (the MCP tools) still work.
- No application code changes. No changes to existing migrations (append-only rule per `docs/upgrade.md`).

## Capabilities

### New Capabilities
- `database-access-control`: PostgreSQL-level access control for the brain database — RLS policies scoped to `service_role` on all tables, and function EXECUTE privileges denied to `anon`/`authenticated`. Covers the requirement that the anon key grants no read or write access to any brain data or privileged function.

### Modified Capabilities

(none — the `people` MCP tools' behavior is unchanged; this fixes database-layer policy only, which no existing spec in `openspec/specs/` covers)

## Non-goals

- No change to the edge-function authentication model (shared `MCP_ACCESS_KEY`, header vs query param) — that is Step 3 (`feature/HeaderBasedAuth`) of the remediation plan.
- No audit/rework of other tables' policies beyond verifying they are already correctly scoped (they are, per the code-quality review).
- No retention policy for `function_call_logs` or other GDPR lifecycle work — that is Step 25.
- No renaming or restructuring of existing migrations.

## Impact

- **Database:** one new migration in `supabase/migrations/`; affects `public.people` policy and `increment_usefulness` privileges. Production impact: anon-key access to `people` and the RPC stops working — nothing legitimate uses it (the edge function uses the service-role key exclusively, `terrestrial-brain-mcp/index.ts:28`).
- **Tests:** new file `tests/integration/db_access_control.test.ts` (anon-key denial + service-role regression).
- **Deployment:** `npx supabase db push` on prod per `scripts/deploy-update-prod.sh` / `docs/upgrade.md`.
