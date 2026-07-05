# production-deployment Specification

## Purpose

Behavioral requirements for the production setup and deploy shell scripts (`scripts/initial-setup-prod.sh`, `scripts/deploy-update-prod.sh`): failure surfacing and exit codes, the opt-in SELinux workaround and its guaranteed restoration, robust project-ref resolution, and secret-handling confidentiality.

## Requirements

### Requirement: Deploy script surfaces edge-function failures via exit code

The deploy script (`scripts/deploy-update-prod.sh`) SHALL exit with a non-zero status when any edge-function deployment fails, and SHALL exit zero only when every function deployed successfully. It MUST NOT report "Deploy complete" as if successful when one or more functions failed.

#### Scenario: One function fails to deploy
- **WHEN** the script deploys multiple edge functions and at least one `supabase functions deploy` invocation returns non-zero
- **THEN** the script prints which function(s) failed AND exits with status 1

#### Scenario: All functions deploy successfully
- **WHEN** every `supabase functions deploy` invocation succeeds
- **THEN** the script completes the remaining steps and exits with status 0

### Requirement: SELinux workaround is opt-in and always restored

The deploy script's SELinux permissive-mode workaround SHALL run only when explicitly enabled via the `TB_SELINUX_WORKAROUND=1` environment variable. When enabled and the workaround switches SELinux to permissive, the script SHALL restore the prior enforcing state on ANY exit path — normal completion, error, or interrupt (Ctrl-C) — via a trap handler, never leaving the host permissive.

#### Scenario: Workaround not enabled
- **WHEN** `TB_SELINUX_WORKAROUND` is unset or not `1`
- **THEN** the script does not call `setenforce` and does not require `sudo` for SELinux

#### Scenario: Workaround enabled and script is interrupted mid-deploy
- **WHEN** `TB_SELINUX_WORKAROUND=1`, SELinux was Enforcing, the script switched it to Permissive, and the script is then interrupted (SIGINT) or fails before normal completion
- **THEN** the trap handler restores SELinux to Enforcing before the script exits

#### Scenario: Workaround enabled and deploy completes normally
- **WHEN** `TB_SELINUX_WORKAROUND=1`, SELinux was Enforcing, and the deploy runs to completion
- **THEN** SELinux is Enforcing again after the script exits

### Requirement: Project ref resolved robustly, not by glyph-scraping

The deploy script SHALL resolve the linked Supabase project ref from a machine-readable source (`supabase/.temp/project-ref` file, or `supabase projects list --output json`) rather than by `awk`-matching a decorative glyph (`●`) in human-formatted CLI output. When no linked project can be resolved, it SHALL exit non-zero with an actionable message.

#### Scenario: Linked project ref file present
- **WHEN** `supabase/.temp/project-ref` exists and contains a project ref
- **THEN** the script uses that ref without parsing decorative CLI output

#### Scenario: No linked project resolvable
- **WHEN** no project ref can be resolved from any machine-readable source
- **THEN** the script prints how to link a project and exits with status 1

### Requirement: Scripts reference their real filenames

The scripts SHALL reference the actual deploy script filename (`deploy-update-prod.sh`) in usage comments and user-facing output. No script SHALL reference the non-existent `deploy-prod.sh`.

#### Scenario: Usage comment and next-steps output
- **WHEN** a reader inspects the deploy script's usage header or runs the setup script to completion
- **THEN** every referenced script filename names a file that exists in `scripts/`

### Requirement: Setup script keeps secrets confidential

The setup script (`scripts/initial-setup-prod.sh`) SHALL read secret values without echoing them to the terminal (`read -rs`), and SHALL pass them to the Supabase CLI as a quoted bash array so that word-splitting and globbing cannot corrupt a value and the values are not exposed as a single joined string in the process list.

#### Scenario: Prompting for a secret
- **WHEN** the script prompts the operator for `OPENROUTER_API_KEY` or `MCP_ACCESS_KEY`
- **THEN** the typed characters are not echoed to the terminal

#### Scenario: Passing secrets to the CLI
- **WHEN** the script invokes `supabase secrets set` with the collected secrets
- **THEN** each secret is passed as a separate quoted array element (`"${SECRETS[@]}"`), and a secret containing spaces or shell metacharacters is transmitted intact
