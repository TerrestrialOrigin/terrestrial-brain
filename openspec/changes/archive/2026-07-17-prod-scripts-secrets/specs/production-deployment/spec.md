## MODIFIED Requirements

### Requirement: Setup script keeps secrets confidential

The setup script (`scripts/initial-setup-prod.sh`) SHALL read secret values without echoing them to the terminal (`read -rs`), and SHALL pass them to the Supabase CLI via a private env-file (created `0600` with `umask 077` + `mktemp`, supplied with `--env-file`, and removed by a `trap ... EXIT`) — NEVER as process arguments, which are world-readable via `ps` / `/proc/<pid>/cmdline` on a shared machine. The "set them later" hints in the prod scripts SHALL teach the env-file form, not the argv form.

#### Scenario: Prompting for a secret
- **WHEN** the script prompts the operator for `OPENROUTER_API_KEY` or `MCP_ACCESS_KEY`
- **THEN** the typed characters are not echoed to the terminal

#### Scenario: Passing secrets to the CLI
- **WHEN** the script invokes `supabase secrets set` with the collected secrets
- **THEN** the secrets are supplied via `--env-file <0600 temp file>` and no secret value appears in the command's arguments; the temp file is removed on exit

## ADDED Requirements

### Requirement: Prod scripts verify the retention purge job exists

Both `scripts/initial-setup-prod.sh` and `scripts/deploy-update-prod.sh` SHALL verify, against the linked project, that the `purge-function-call-logs-daily` cron job exists (the GDPR retention control for `function_call_logs`, which holds note content and IP addresses). If the job is absent or cannot be confirmed, the script SHALL print a loud WARNING to stderr and exit non-zero, rather than completing silently.

#### Scenario: Retention job present
- **WHEN** the verification step runs and the linked project has the `purge-function-call-logs-daily` job
- **THEN** the script reports the job is scheduled and continues

#### Scenario: Retention job missing
- **WHEN** the verification step runs and the job is absent (e.g. pg_cron was unavailable at migration time)
- **THEN** the script prints a WARNING and exits non-zero, so the fail-open is not silent
