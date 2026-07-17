## ADDED Requirements

### Requirement: Denial is asserted for every table and every RPC at both test layers

Anon/authenticated denial SHALL be asserted for **every** `public`-schema table and **every** exposed RPC, not only for `people` and `increment_usefulness`. Coverage SHALL exist at two layers: a pgTAP suite (privilege-level, run by `supabase test db`) and the Deno integration suite (transport-level, exercising the anon publishable key through the REST API). A generic meta-assertion SHALL fail if any `public` policy is scoped to a role other than `service_role`.

#### Scenario: Every table denies anon and authenticated SELECT and INSERT (pgTAP)

- **WHEN** the pgTAP denial suite runs against a fresh database
- **THEN** for each of `thoughts`, `projects`, `tasks`, `note_snapshots`, `ai_output`, `people`, `documents`, `function_call_logs`, a `SELECT` and an `INSERT` attempted as `anon` and as `authenticated` each raise SQLSTATE `42501`

#### Scenario: Every exposed RPC denies EXECUTE to anon and authenticated (pgTAP)

- **WHEN** the pgTAP denial suite runs
- **THEN** `EXECUTE` on each of `search_thoughts_by_embedding`, `thought_stats`, `increment_usefulness`, `increment_usefulness_weighted`, `purge_function_call_logs`, `get_pending_ai_output_metadata`, `normalize_thought_project_refs` attempted as `anon` and as `authenticated` raises SQLSTATE `42501`

#### Scenario: A non-service_role policy fails the meta-assertion

- **WHEN** any policy in the `public` schema is scoped to a role other than `service_role`
- **THEN** the pgTAP policy-scope meta-assertion fails

#### Scenario: The anon publishable key is denied on every brain-data table (Deno)

- **WHEN** the Deno integration denial suite issues an anon-key REST `SELECT` against each brain-data table
- **THEN** each request is rejected with a permission-denied error (SQLSTATE `42501`) and no data is returned
