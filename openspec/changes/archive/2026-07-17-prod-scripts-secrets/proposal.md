## Why

Two production-deployment defects. (SCRIPT-1) `initial-setup-prod.sh` reads secrets without echo but then passes them to `supabase secrets set` as argv (`"${SECRETS[@]}"`), so both the OpenRouter key and MCP access key are world-readable via `ps` / `/proc/<pid>/cmdline` for the lifetime of the (network-bound) CLI call — on a machine the project explicitly assumes is shared. (SQL-7) The retention purge of `function_call_logs` (note content + IP addresses) is scheduled best-effort via pg_cron in a migration whose handler catches ALL exceptions, so a production scheduling failure passes silently and nothing ever verifies the GDPR purge job exists.

## What Changes

- `initial-setup-prod.sh`: write the two secrets to a `mktemp` env-file created `0600` (`umask 077`), pass them via `supabase secrets set --env-file`, and remove the file via a `trap ... EXIT` so an interrupted run leaves nothing. Update the "set them later" hints in both prod scripts to teach the env-file form, not the argv form.
- Both prod scripts: after listing migration status, verify the linked project has the `purge-function-call-logs-daily` cron job (`supabase db query --linked`) and **exit non-zero with a loud WARNING** if it is absent — a GDPR retention control must not fail open silently.
- Static-content test (`tests/unit/prod-scripts.test.ts`) locking in both properties (the scripts can't run against prod here).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `production-deployment`: secrets SHALL be passed to the CLI via a private (0600) env-file removed on exit, never as process arguments; both prod scripts SHALL verify the retention purge cron job exists on the linked project and fail loud if it does not.

## Non-goals

- Narrowing the retention migration's `exception when others` handler (would risk the local `db reset` path that every gate depends on; the script-level verification now provides the loud signal). Documented, not silently skipped.
- Any change to what secrets exist or the retention window.

## Impact

- `scripts/initial-setup-prod.sh`, `scripts/deploy-update-prod.sh`, `tests/unit/prod-scripts.test.ts`.
- Affected spec: `openspec/specs/production-deployment/spec.md`.
