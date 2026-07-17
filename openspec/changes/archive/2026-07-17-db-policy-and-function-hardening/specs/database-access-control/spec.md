## ADDED Requirements

### Requirement: The function_call_logs policy is scoped to service_role via a `to` clause

The `public.function_call_logs` RLS policy SHALL be scoped `to service_role` with `using (true) with check (true)`, replacing the original unscoped policy `"Service role full access"` that applied to all roles and relied solely on a per-row `auth.role()` predicate. Because this table holds personal data (serialized tool inputs and `ip_address`), its access control SHALL NOT depend on a row predicate that a grant drift could bypass.

#### Scenario: function_call_logs policy is scoped to service_role

- **WHEN** the migrations are applied to a blank database
- **THEN** the `public.function_call_logs` policy has `roles = {service_role}` in `pg_policies` (no policy applies to `PUBLIC`, `anon`, or `authenticated`)

#### Scenario: Anon key cannot read function_call_logs

- **WHEN** a log row exists (written via the service role) and a client selects from `function_call_logs` through the REST API using the anon key
- **THEN** the request is rejected with a permission-denied error (SQLSTATE 42501) and no data is returned

### Requirement: SECURITY DEFINER and trigger functions pin search_path with pg_temp

Every `SECURITY DEFINER` function and every trigger function in the `public` schema SHALL pin `set search_path = public, pg_temp`, so the session temporary schema is searched last and a caller-created temp object cannot shadow a referenced table. This SHALL include `public.increment_usefulness(uuid[])`, `public.increment_usefulness_weighted(uuid[], int)`, and the `public.update_updated_at()` trigger function.

#### Scenario: The usefulness RPCs and the updated_at trigger pin pg_temp

- **WHEN** the migrations are applied to a blank database
- **THEN** `increment_usefulness`, `increment_usefulness_weighted`, and `update_updated_at` each have `search_path` configured as `public, pg_temp`

#### Scenario: Existing service-role behavior is preserved

- **WHEN** usefulness recording and row updates run through the service-role path after the hardening migration
- **THEN** `usefulness_score` and `updated_at` are maintained exactly as before, and the `thoughts_updated_at` trigger remains bound to `update_updated_at`
