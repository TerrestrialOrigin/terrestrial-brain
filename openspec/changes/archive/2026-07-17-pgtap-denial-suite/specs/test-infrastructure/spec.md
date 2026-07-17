## ADDED Requirements

### Requirement: A pgTAP database-test suite covers DB-level invariants and RLS denial

The repository SHALL maintain a pgTAP suite under `supabase/tests/` runnable via `supabase test db`, and it SHALL include RLS denial coverage (`supabase/tests/rls_denial.test.sql`) asserting anon/authenticated denial for every table and RPC plus a `pg_policies` scope meta-assertion. The suite SHALL pass on a freshly reset stack.

#### Scenario: The pgTAP suite runs and passes

- **WHEN** `supabase test db` runs against a freshly reset stack
- **THEN** all pgTAP files, including the RLS denial suite, report PASS with zero failures

#### Scenario: The denial suite exists

- **WHEN** the test tree is inspected
- **THEN** `supabase/tests/rls_denial.test.sql` is present and contains per-table denial, per-RPC denial, and the policy-scope meta-assertion
