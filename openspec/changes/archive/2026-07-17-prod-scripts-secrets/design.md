## Context

SCRIPT-1 and SQL-7. `initial-setup-prod.sh` and `deploy-update-prod.sh` both `set -euo pipefail` and use `npx supabase`. The retention cron job name is `purge-function-call-logs-daily` (from `20260706000002`). The Supabase CLI exposes `db query --linked` (Management API — no DB password needed), which is the verification mechanism.

## Goals / Non-Goals

**Goals:** secrets never on argv; both scripts fail loud if the GDPR purge job is missing. **Non-Goals:** migration exception-handler narrowing (risks local reset — deferred with rationale); retention-window changes.

## Decisions

**D1 — env-file over argv, with umask + trap.** `SECRETS_FILE="$(umask 077 && mktemp)"` guarantees 0600 at creation (no race), `--env-file` keeps values off the process list, and `trap 'rm -f "${SECRETS_FILE:-}"' EXIT` (cleared after an explicit `rm`) guarantees cleanup even on interrupt. The env-file is `KEY=value` lines, which the CLI parses. Alternative (stdin) rejected: the CLI has no documented stdin form; the env-file form is first-class.

**D2 — Verify via `db query --linked`, fail non-zero.** The query `select jobname from cron.job where jobname = 'purge-function-call-logs-daily'` piped to `grep -q`; on no match (job absent OR query unable to confirm) the script prints a WARNING to stderr and `exit 1`. `set -o pipefail` makes a failed query propagate into the `if` as false → the loud branch. This converts a silent GDPR fail-open into a blocking deploy error.

**D3 — Do NOT narrow the migration handler.** The migration's `exception when others` is over-broad, but narrowing it to specific SQLSTATEs risks breaking local `db reset` (where pg_cron is genuinely unavailable) — and that path underpins every gate. The script-level verification (D2) already supplies the loud production signal, so the migration is left unchanged and the residual is documented, not hidden.

### User error scenarios
- **Operator declines to set secrets:** the hint now teaches the env-file form (chmod 600), not the argv form.
- **Operator runs setup where pg_cron is disabled in prod:** the verification fails the run with actionable guidance (enable pg_cron, re-push) instead of a silent success.
- **Interrupted run mid-secret-write:** the EXIT trap removes the temp env-file.

### Security analysis
- **Threat: secret disclosure via process list** on a shared host — closed by moving secrets off argv into a 0600 file for the CLI call's duration.
- **Threat: GDPR retention control fails open** — closed by the fail-loud verification; note content + IPs can no longer be retained indefinitely without a deploy-time signal.
- No new secrets, endpoints, or privileges; the env-file lives only for the CLI call and is trap-removed.

### Test Strategy
- Static-content unit test asserts: `--env-file` is used and the argv form is absent; `umask 077` + `mktemp` + the EXIT trap are present; both scripts contain the `cron.job` verification + `exit 1`; the hints teach the env-file form. GATE 2b: reverting either change reddens the matching assertion. `bash -n` syntax-checks both scripts. The scripts are prod-only, so end-to-end execution is out of scope (documented).

## Risks / Trade-offs

- **[`db query --linked` might lack permission to read `cron.job` in some prod configs]** → Then the check fails closed (WARNING + exit 1), which is the safe direction; the operator confirms manually. Preferable to the prior silent pass.
- **[Static tests assert text, not runtime behavior]** → Unavoidable for prod-only scripts; combined with `bash -n` they catch the regression this step targets (a revert to argv or a dropped verification).
