# Design: fix-db-security-policies

## Context

The system's trust model is: a single shared `MCP_ACCESS_KEY` is enforced at the edge function, the edge function talks to PostgreSQL exclusively with the **service-role** key (`terrestrial-brain-mcp/index.ts:28`), and RLS exists solely to lock the **anon** key out of all data. `supabase/migrations/20260322000004_enable_rls.sql` implements this correctly for `thoughts`, `projects`, `tasks`, `note_snapshots`, etc. — every policy there is `for all to service_role using (true) with check (true)`.

Two later migrations broke the model:

1. `20260324000001_people.sql:24-26` creates policy `"Allow all for service role"` on `public.people` **without a `to service_role` clause**. A policy with no `TO` applies to `PUBLIC` (all roles). Combined with Supabase's default table grants to `anon`/`authenticated`, any holder of the project's anon key has full CRUD on `people` — names, emails, descriptions. This is personal data, so it is also a GDPR exposure (finding S1).
2. `20260404000001_thoughts_usefulness_score.sql` creates `increment_usefulness(uuid[])` as `SECURITY DEFINER`. Supabase grants `EXECUTE` on public-schema functions to `anon`/`authenticated` by default, and `SECURITY DEFINER` makes the function run as its owner, bypassing RLS. An anon-key holder can inflate any thought's `usefulness_score`, silently distorting the AI's relevance ranking (finding S3).

Constraint: migrations are **append-only** (`docs/upgrade.md`) — existing migration files must not be edited.

## Goals / Non-Goals

**Goals:**
- The anon key grants zero read or write access to `people`.
- The anon key cannot execute `increment_usefulness`.
- Service-role access (the MCP tools) is unchanged — verified by regression assertions.
- The exploit is replicated by failing tests **before** the fix lands (bug-fix rule).

**Non-Goals:**
- Edge-function auth changes (shared-key header auth is Step 3, `feature/HeaderBasedAuth`).
- Auditing/reworking other tables' policies — already verified correct in the code eval.
- `function_call_logs` retention / GDPR lifecycle (Step 25).
- Editing or renaming existing migrations.

## Decisions

### D1: One new append-only migration covering both fixes
A single migration `supabase/migrations/<timestamp>_fix_db_security_policies.sql` fixes both objects. They are one logical remediation (restore the "anon has no access" invariant), ship together, and roll back together. Alternative — two migrations — adds ceremony with no isolation benefit since neither half can sensibly deploy without the other.

### D2: Recreate the `people` policy in the canonical shape, with the canonical name
Drop `"Allow all for service role"` and create `"Service role full access on people"`:

```sql
drop policy "Allow all for service role" on public.people;
create policy "Service role full access on people"
  on public.people
  for all
  to service_role
  using (true)
  with check (true);
```

This matches the exact naming and shape used by every other table in `20260322000004_enable_rls.sql`, so a future audit greps one pattern. Alternative — `ALTER POLICY ... TO service_role` keeping the misleading old name — rejected: the name `"Allow all for service role"` is what hid the bug in review.

### D3: Revoke function EXECUTE from `public`, `anon`, `authenticated`; grant explicitly to `service_role`
Generalized during implementation (see D10) to ALL public-schema functions plus matching `alter default privileges`, so no future RPC ships callable by anon:

```sql
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
```

Revoking from `public` (not just the two named roles) removes the default grant at its source, so re-granted roles are explicit. The explicit `service_role` grant makes the intended caller self-documenting and safe against the `public` revocation. Alternative — dropping `SECURITY DEFINER` on `increment_usefulness` — rejected: the function is *meant* to bypass RLS when called by the service path; the bug is who may call it, not what it does.

### D4: Denial semantics the tests assert (PostgREST behavior)
With D10's grant revocation in place, every anon attempt fails at the **privilege** level (before RLS is even consulted): HTTP 401/403 with SQLSTATE `42501` for SELECT, INSERT, UPDATE, DELETE, and RPC alike. Tests assert the rejection status/code AND verify zero state change by re-reading via the service role. (Pre-fix replication observed the RLS-only semantics: filtered SELECTs, zero-row UPDATE/DELETE — the failing-first run captured anon succeeding at all five operations.)

### D10: Explicit privileges instead of environment-default privileges (implementation discovery)
A fresh `supabase db reset` under the current CLI/postgres image (CLI 2.109.0, PG 17) revealed that **newer Supabase images grant NO table DML or function EXECUTE to `anon`, `authenticated`, or even `service_role`** by default (`pg_default_acl` for role `postgres` grants only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) — while older environments (the linked prod project, pre-reset local volumes) grant full DML to all three. A schema that relies on those defaults either leaves anon wide open (old environments — the S1 exploit) or breaks the service path entirely (new environments — service_role cannot read its own tables). The migration therefore states the trust model explicitly, working identically on both generations:
- `grant select, insert, update, delete on all tables in schema public to service_role` + `alter default privileges` for future tables.
- `revoke` the same from `anon, authenticated` + matching `alter default privileges` (defense in depth on old environments; no-op on new ones).
- Same pattern for function EXECUTE (D3).
RLS policies stay as the second layer (D2) — belt and braces, and prod's `people` policy fix remains necessary in its own right.

### D5: Replicate-first test file `tests/integration/db_access_control.test.ts`
New Deno test file, no mocks anywhere (real local Supabase stack via `npx supabase start`), driven by the **anon key** from the local stack plus the service-role key for seeding/verification. Written and confirmed **failing** against the current schema before the migration exists — this is the access-**denial** coverage GATE 1 requires for an access-control change; the happy path alone does not test permissions. Existing suites (`thoughts.test.ts` usefulness tests, people MCP tools tests) double as the service-role regression net; the new file adds one explicit service-role regression assertion per fixed object so denial and regression live side by side.

### D6: User / operator error scenarios
This change has no UI, so the "user" is a developer or operator:
- **Operator deploys app code without the migration** → the vulnerability simply persists (no breakage); `scripts/deploy-update-prod.sh` runs `npx supabase db push`, which applies pending migrations in order, closing the gap on the next standard deploy.
- **Migration run twice / out of order** → `supabase db push` tracks applied migrations by version; re-runs are no-ops. The `drop policy` targets a policy guaranteed to exist by `20260324000001`, which always precedes this migration.
- **Developer adds a future table and copies the bad policy shape** → the canonical-name cleanup (D2) leaves exactly one policy pattern to copy; the delta spec's blanket requirement ("anon key grants no access to any brain data") makes the denial test the template for the next table.
- **Someone "fixes" the old migration file instead of appending** → prohibited by the append-only rule; this design and `docs/upgrade.md` both state it.

### D7: Security analysis
Threats identified for this change (full write-up in `docs/ThreatModel.md`, created by this change):
- **T1 — PII exfiltration/tampering via anon key** (people table): mitigated by D2.
- **T2 — Ranking poisoning via anon RPC** (usefulness_score inflation): mitigated by D3.
- **T3 — Regression re-introducing default-executable SECURITY DEFINER functions**: partially mitigated by the ThreatModel checklist entry requiring an explicit `revoke ... from public` for every future `security definer` function; the denial-test pattern (D5) is the enforcement template.
- **Residual risk**: the anon key still authenticates to PostgREST (empty result sets, error oracles) and the shared-secret edge auth is unchanged until Step 3. Accepted for this step.

### D8: API contract
No API changes. No MCP tool signatures, edge-function routes, or response shapes change; `docs/api-frontend-guide.md` is not applicable to this change (database-layer only).

### D9: Test strategy
- **Unit tests**: none — there is no application logic in this change; a unit test of SQL text would be vacuous.
- **Integration tests** (the layer that carries this change): `tests/integration/db_access_control.test.ts` against the real local stack — anon-key denial for `people` (select/insert/update/delete) and the RPC, plus service-role regression for both objects. Zero mocks on the tested path.
- **E2E**: this repo has no browser UI; the Deno integration suite against the full local Supabase stack *is* the end-to-end layer here (per `codeEval/Fable20260704-fix-plan.md` protocol note). The full suite (`deno test --allow-net --allow-env tests/`) plus `cd obsidian-plugin && npm test && npm run build` must pass with zero failures and zero skips.

Scenario→layer mapping lives in `test-plan.md`.

## Risks / Trade-offs

- **[Risk] Some overlooked legitimate consumer uses the anon key against `people` or the RPC** → Mitigation: code eval verified the edge function uses only the service-role key and the plugin only talks to the edge function; the regression assertions prove the legitimate paths still work. Worst case, the failure mode is loud (403/empty reads), not silent corruption.
- **[Risk] Local test behavior diverges from hosted Supabase (grant defaults differ)** → Mitigation: local stack runs the same Postgres + PostgREST images and the same migrations; the failing-first step proves the local stack reproduces the hosted default grants.
- **[Trade-off] `usefulness_score` remains writable via generic service-role table update** → Acceptable: service_role is trusted by definition in this model; scoping *which* server code may call what is an application-layer concern outside this step.

## Migration Plan

1. Land migration + tests on `bug/DbSecurityPolicies`.
2. Local: `npx supabase db reset` (or `supabase migration up`) applies the migration; run full suite.
3. Prod: `scripts/deploy-update-prod.sh` → `npx supabase db push` (per `docs/upgrade.md`).
4. **Rollback**: append a new reverting migration (recreate the permissive grants) — never edit history. Realistically unneeded: nothing legitimate loses access.

## Open Questions

None — the fix is fully specified by findings S1/S3 and the canonical policy pattern already in the codebase.
