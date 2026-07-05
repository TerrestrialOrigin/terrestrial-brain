# Threat Model — Terrestrial Brain

Living document. Each OpenSpec change with a security dimension adds or updates entries here (per the workflow rule that design.md must document threats and preventions).

## Trust model (current)

- The Supabase **service-role key** is held only by the `terrestrial-brain-mcp` edge function. All legitimate data access flows through it. (The former `ingest-thought` Slack function also held it; that function was removed in change `remove-slack-integration`.)
- The edge function authenticates callers with a single shared secret (`MCP_ACCESS_KEY`).
- The **anon (publishable) key** is public by definition and must grant **no** access to any brain data or privileged function. This is enforced at two layers:
  1. **Privileges**: `anon`/`authenticated` hold no table DML grants and no function `EXECUTE` in the `public` schema (migration `20260704000001_fix_db_security_policies.sql`).
  2. **RLS**: every table has row level security enabled with policies scoped `for all to service_role`.

## Threats and mitigations

### T1 — PII exfiltration/tampering via the anon key (people table)
**Threat:** The `people` RLS policy `"Allow all for service role"` was created without a `to service_role` clause, so it applied to all roles. On environments with default table grants, any anon-key holder had full CRUD on `people` (names, emails, descriptions — personal data; GDPR exposure). Finding S1 in `codeEval/Fable20260704.md`.
**Mitigation:** Policy recreated scoped `to service_role`; anon/authenticated DML grants revoked outright. Covered by denial tests in `tests/integration/db_access_control.test.ts`.

### T2 — Ranking poisoning via anon RPC (increment_usefulness)
**Threat:** `increment_usefulness(uuid[])` is `SECURITY DEFINER` (bypasses RLS by design) and was executable by `anon`/`authenticated` via default function grants, letting an anon-key holder silently inflate any thought's `usefulness_score` and distort AI retrieval ranking. Finding S3.
**Mitigation:** `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated` on **all** `public`-schema functions; granted to `service_role` only. Covered by RPC denial + service-role regression tests.

### T3 — Regression: future objects shipping with permissive defaults
**Threat:** A future migration adds a table, or a `SECURITY DEFINER` function, and inherits whatever the environment's default privileges happen to be (older Supabase environments grant DML/EXECUTE to anon by default).
**Mitigation:** `alter default privileges for role postgres in schema public` now bakes the service_role-only posture into future tables and functions. **Standing rule:** every new table still gets an explicit `for all to service_role` RLS policy in its creating migration, and any new `SECURITY DEFINER` function's migration should state its intended grants explicitly. Use the denial tests in `db_access_control.test.ts` as the template.

### Residual / accepted risks (this change's scope)
- The anon key still authenticates to PostgREST itself; error responses reveal object existence (low value to an attacker — the schema is open source).
- The edge-function shared-secret auth (`?key=` query param, non-constant-time comparison) is unchanged — remediation Step 3 (`feature/HeaderBasedAuth`) addresses it.
- `function_call_logs` retention/GDPR lifecycle — remediation Step 25.
