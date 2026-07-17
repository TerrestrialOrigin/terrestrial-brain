# developer-workflow Specification

## Purpose
Defines the project's continuous-integration pipeline and one-command local
development contract: what CI verifies on every push/pull request (a
deterministic, key-free backend suite plus lint, format check, and the plugin
test + build), the lint/format configuration that covers sources and tests, and
how a contributor starts and cleanly (scoped) stops the full local stack with a
single command that stays in sync with CI via `scripts/validate-all.sh`.

## Requirements
### Requirement: Continuous integration verifies every push and pull request
The project SHALL provide a GitHub Actions workflow that runs on every push and pull request and verifies the full test and build surface without any live paid API. The workflow SHALL fail (non-zero, red check) if any test fails, any lint error is present, any file is not formatted, the plugin build fails, or any pgTAP database test fails. The workflow SHALL run `supabase test db` (the pgTAP suite, including RLS denial coverage) between starting the Supabase stack and running the Deno suite.

#### Scenario: Backend suite runs deterministically with the fake AI provider
- **WHEN** the CI workflow runs
- **THEN** it starts a minimal local Supabase stack, sets `TB_AI_PROVIDER=fake`, and runs `deno task test`
- **AND** no `OPENROUTER_API_KEY` is required for the run to pass

#### Scenario: pgTAP database tests run in CI
- **WHEN** the CI workflow runs
- **THEN** it runs `supabase test db` after the Supabase stack is up and before the Deno suite
- **AND** the job fails if any pgTAP test (including RLS denial) fails

#### Scenario: Lint and formatting are enforced
- **WHEN** the CI workflow runs
- **THEN** it runs `deno lint` and `deno fmt --check` over the configured source and test directories
- **AND** the job fails if any lint violation or unformatted file is found

#### Scenario: Plugin is tested and built
- **WHEN** the CI workflow runs
- **THEN** it runs `npm ci`, `npm test`, and `npm run build` in `obsidian-plugin/`
- **AND** the job fails if the plugin tests fail or the build errors

#### Scenario: A failing test blocks the PR
- **WHEN** a pull request contains a change that makes any test fail
- **THEN** the CI check reports failure on that pull request

### Requirement: Lint and format configuration covers sources and tests
The repository SHALL declare Deno lint and format configuration (in `deno.json` or an equivalent Deno config) whose include set covers the backend function sources and the `tests/` tree, and whose exclude set omits generated, vendored, and non-Deno directories (e.g. `obsidian-plugin/`, `node_modules/`, build output). The checked-in sources SHALL satisfy `deno fmt --check` and `deno lint` so a fresh run is green.

#### Scenario: fmt check passes on a clean checkout
- **WHEN** `deno fmt --check` runs on a fresh checkout of the branch
- **THEN** it reports no files needing formatting

#### Scenario: lint passes on a clean checkout
- **WHEN** `deno lint` runs on a fresh checkout of the branch
- **THEN** it reports zero problems

### Requirement: One command starts the full local development stack
The project SHALL provide a single command (`deno task dev`) that starts the local Supabase stack, serves the edge functions, and builds/watches the Obsidian plugin, so a contributor does not have to start each piece manually.

#### Scenario: Single command brings up the stack
- **WHEN** a contributor runs `deno task dev`
- **THEN** the Supabase stack starts, the edge functions are served, and the plugin is built in watch mode

### Requirement: Development stack cleans up on exit
The one-command dev workflow SHALL stop the services it started when the process exits (Ctrl-C or normal termination), and the teardown SHALL be scoped to this repository's own stack — it MUST NOT kill unrelated processes or services by broad name match.

#### Scenario: Ctrl-C tears down the stack it started
- **WHEN** the contributor stops `deno task dev` with Ctrl-C
- **THEN** the Supabase stack this command started is stopped
- **AND** no processes outside this repository's stack are terminated

### Requirement: Validation script matches the CI invocation
The `scripts/validate-all.sh` helper SHALL invoke the same deterministic, task-based commands used by CI (running the Deno suite with `TB_AI_PROVIDER=fake` via the `deno task` entry points, and running `supabase test db`) so local validation and CI cannot diverge.

#### Scenario: Local validation mirrors CI
- **WHEN** a contributor runs `scripts/validate-all.sh` with the local stack up
- **THEN** it runs `supabase test db`, the same deterministic `deno task` test command, and the plugin test + build that CI runs


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
