## Why

The two production shell scripts (`scripts/deploy-update-prod.sh`, `scripts/initial-setup-prod.sh`) have safety and security defects (eval finding C11): the deploy script reports success even when edge-function deploys fail and can leave the host's SELinux permissive if interrupted mid-deploy, and the setup script echoes secrets to the terminal and leaks them through the process list via unquoted word-splitting. These scripts touch production and the developer's machine security posture, so the defects are high-impact despite the small code size.

## What Changes

- **Deploy script (`deploy-update-prod.sh`)**:
  - Exit non-zero (`exit 1`) when any edge-function deploy fails, instead of warning and exiting 0.
  - Move the SELinux `setenforce` restore into a `trap ... EXIT` handler so an interrupt (Ctrl-C) or mid-script failure can never leave the machine permissive.
  - Gate the entire SELinux workaround behind an opt-in env flag (`TB_SELINUX_WORKAROUND=1`) — it is one developer's machine policy, not something every operator should silently trigger with `sudo`.
  - Resolve `PROJECT_REF` from `supabase/.temp/project-ref` (with a `--output json` fallback) instead of `awk`-matching the `●` glyph in human-formatted CLI output.
  - Fix the stale `deploy-prod.sh` filename in the usage comment (the real script is `deploy-update-prod.sh`).
- **Setup script (`initial-setup-prod.sh`)**:
  - Read secrets with `read -rs` so they are not echoed to the terminal.
  - Pass secrets to the CLI as a quoted bash array (`npx supabase secrets set "${SECRETS[@]}"`), never as an unquoted variable subject to word-splitting/globbing and never visibly in the process list as a single joined string.
  - Fix the stale `deploy-prod.sh` reference in the "next steps" output.

## Capabilities

### New Capabilities
- `production-deployment`: Behavioral requirements for the production setup and deploy scripts — failure surfacing/exit codes, SELinux workaround safety and opt-in gating, robust project-ref resolution, and secret-handling confidentiality.

### Modified Capabilities
<!-- None: no existing spec covers the deployment scripts. -->

## Impact

- `scripts/deploy-update-prod.sh`, `scripts/initial-setup-prod.sh` — behavior and hardening changes.
- No application code, database, API, or dependency changes. This repo has no terrestrial-core dependency.
- Operators must set `TB_SELINUX_WORKAROUND=1` to keep the previous automatic SELinux behavior; without it the deploy runs without touching SELinux (documented in the script header). This is an intentional behavior change for safety.

## Non-goals

- No automated test harness for the scripts (they invoke `sudo`, the Supabase CLI, and remote deploys). Verification is `shellcheck`-clean plus a documented manual walkthrough, as the fix-plan specifies.
- No changes to `validate-all.sh`, the migrations, or the edge functions themselves.
- No cross-platform (non-SELinux) deploy support beyond making the SELinux path opt-in.
