## MODIFIED Requirements

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

### Requirement: Validation script matches the CI invocation
The `scripts/validate-all.sh` helper SHALL invoke the same deterministic, task-based commands used by CI (running the Deno suite with `TB_AI_PROVIDER=fake` via the `deno task` entry points, and running `supabase test db`) so local validation and CI cannot diverge.

#### Scenario: Local validation mirrors CI
- **WHEN** a contributor runs `scripts/validate-all.sh` with the local stack up
- **THEN** it runs `supabase test db`, the same deterministic `deno task` test command, and the plugin test + build that CI runs
