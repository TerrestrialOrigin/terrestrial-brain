# database-access-control

PostgreSQL-level access control for the brain database. The anon (publishable) key must grant no read or write access to any brain data or privileged function; all data access flows through the service role used by the edge functions. Privileges are stated explicitly in migrations — never inherited from Supabase environment defaults, which differ between platform generations.

## ADDED Requirements

### Requirement: RLS policies grant table access to service_role only
Every table in the `public` schema SHALL have row level security enabled with its access policies scoped `to service_role`. No policy SHALL apply to `PUBLIC`, `anon`, or `authenticated`. In particular, `public.people` SHALL be governed by a policy scoped `to service_role`, replacing the unscoped policy `"Allow all for service role"`.

#### Scenario: People policy is scoped to service_role
- **WHEN** the migrations are applied to a blank database
- **THEN** `public.people` has exactly one policy, `"Service role full access on people"`, applying `for all to service_role`

### Requirement: Anon and authenticated roles hold no data privileges
Table DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on all `public`-schema tables SHALL be granted to `service_role` and revoked from `anon` and `authenticated`, with matching `alter default privileges` so future tables inherit the same posture. Privileges SHALL NOT depend on Supabase environment defaults.

#### Scenario: Anon key cannot read people
- **WHEN** a person row exists (created via the service role) and a client selects from `people` through the REST API using the anon key
- **THEN** the request is rejected with a permission-denied error (SQLSTATE 42501) and no data is returned

#### Scenario: Anon key cannot insert into people
- **WHEN** a client inserts a row into `people` through the REST API using the anon key
- **THEN** the request is rejected with a permission-denied error (SQLSTATE 42501) and no row is created

#### Scenario: Anon key cannot update people
- **WHEN** a person row exists and a client issues an update against it through the REST API using the anon key
- **THEN** the request is rejected and the row's data is unchanged when re-read via the service role

#### Scenario: Anon key cannot delete from people
- **WHEN** a person row exists and a client issues a delete against it through the REST API using the anon key
- **THEN** the request is rejected and the row still exists when re-read via the service role

#### Scenario: Service role retains full access to people
- **WHEN** people rows are created, read, updated, and deleted through the service-role connection (as the MCP people tools do)
- **THEN** all operations succeed exactly as before the policy change

### Requirement: Privileged functions are not executable by anon or authenticated
`EXECUTE` on all `public`-schema functions — including `public.increment_usefulness(uuid[])` — SHALL be revoked from `PUBLIC`, `anon`, and `authenticated` and granted to `service_role`, with matching `alter default privileges` so future functions inherit the same posture.

#### Scenario: Anon key cannot execute increment_usefulness
- **WHEN** a client calls the `increment_usefulness` RPC through the REST API using the anon key with any array of thought IDs
- **THEN** the request is rejected with a permission-denied error and no thought's `usefulness_score` changes

#### Scenario: Service role can still execute increment_usefulness
- **WHEN** usefulness recording runs through the service-role path (the `record_useful_thoughts` MCP tool or a direct service-role RPC call) for an existing thought
- **THEN** the thought's `usefulness_score` increments by one
