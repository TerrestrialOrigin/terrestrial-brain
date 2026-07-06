## ADDED Requirements

### Requirement: Continuous integration verifies every push and pull request
The project SHALL provide a GitHub Actions workflow that runs on every push and pull request and verifies the full test and build surface without any live paid API. The workflow SHALL fail (non-zero, red check) if any test fails, any lint error is present, any file is not formatted, or the plugin build fails.

#### Scenario: Backend suite runs deterministically with the fake AI provider
- **WHEN** the CI workflow runs
- **THEN** it starts a minimal local Supabase stack, sets `TB_AI_PROVIDER=fake`, and runs `deno task test`
- **AND** no `OPENROUTER_API_KEY` is required for the run to pass

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
The `scripts/validate-all.sh` helper SHALL invoke the same deterministic, task-based commands used by CI (running the Deno suite with `TB_AI_PROVIDER=fake` via the `deno task` entry points) so local validation and CI cannot diverge.

#### Scenario: Local validation mirrors CI
- **WHEN** a contributor runs `scripts/validate-all.sh` with the local stack up
- **THEN** it runs the same deterministic `deno task` test command and the plugin test + build that CI runs
