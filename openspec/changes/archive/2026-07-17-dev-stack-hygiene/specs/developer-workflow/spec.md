## ADDED Requirements

### Requirement: The local stack uses unique non-default ports

The project's `supabase/config.toml` SHALL assign a unique, non-default port block (not the stock `:54321` family) so the local stack cannot collide with another Supabase project on the same machine. `scripts/validate-all.sh` SHALL derive the API URL from the running stack (`supabase status --output json`) rather than hardcoding a port, so its reachability probe can never match a different project's stack.

#### Scenario: Validation derives the port, not a hardcoded default
- **WHEN** `scripts/validate-all.sh` locates the stack
- **THEN** it reads the API URL from `supabase status --output json` and contains no hardcoded `54321`

#### Scenario: The suite runs against the project's own port
- **WHEN** the full test suite runs against the configured stack
- **THEN** every test reaches the project's own API port (nothing assumes the stock default)

### Requirement: Dev and validation start from a blank slate via npx

`scripts/dev.sh` and `scripts/validate-all.sh` SHALL reset the database (migrations + seed) to a blank slate before use — `dev.sh` by default with a `TB_DEV_KEEP_DATA=1` opt-out — and SHALL invoke the Supabase CLI exclusively through `npx supabase` (including the `gen:types` task). `validate-all.sh` SHALL warm the edge function after the reset so the suite does not race a cold start.

#### Scenario: dev.sh resets by default with an opt-out
- **WHEN** `dev.sh` starts and `TB_DEV_KEEP_DATA` is unset
- **THEN** it runs `npx supabase db reset`; when `TB_DEV_KEEP_DATA=1` it preserves the existing database

#### Scenario: CLI calls go through npx
- **WHEN** `dev.sh` or the `gen:types` task invokes the Supabase CLI
- **THEN** the call is `npx supabase ...`, never a bare global `supabase`

### Requirement: The dependency lockfile is enabled

`deno.json` SHALL enable the lockfile (`"lock": true`) and the repository SHALL commit `deno.lock`, so `npm:`/`jsr:` dependencies are integrity-pinned for the service-role-holding runtime.

#### Scenario: Lockfile is enabled
- **WHEN** `deno.json` is inspected
- **THEN** `"lock"` is not `false` and `deno.lock` is present

### Requirement: CI documentation does not normalize a red required job

The CI workflow SHALL NOT describe any required job (e.g. the Deno test step) as intentionally red; its comments SHALL reflect that the default suite must be fully green.

#### Scenario: No "red by design" required step
- **WHEN** `.github/workflows/ci.yml` is inspected
- **THEN** it contains no comment declaring a required test step red-by-design
