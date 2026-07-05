## Context

Two production scripts under `scripts/` are the only supported path for setting up and updating the Supabase backend:

- `deploy-update-prod.sh` — pushes migrations and redeploys all edge functions to the linked project.
- `initial-setup-prod.sh` — links a project, pushes migrations, deploys functions, and configures secrets.

Both run `set -euo pipefail`. The deploy script contains a machine-specific SELinux workaround (Fedora/Qubes host) that `sudo setenforce 0` before the Docker-backed deploy and restores it inline afterward. Eval finding C11 identifies four concrete defects: (1) the per-function deploy loop only warns on failure and the script still exits 0; (2) the SELinux restore is inline, so an interrupt between `setenforce 0` and the restore leaves the host permissive; (3) secrets in the setup script are read with a plain `read` (echoed) and passed through an unquoted variable subject to word-splitting; (4) `PROJECT_REF` is scraped by `awk`-matching the `●` glyph in human-formatted CLI output. There is also a stale `deploy-prod.sh` filename in comments/output.

These scripts have no automated test suite — they invoke `sudo`, the Supabase CLI, and remote deploys, none of which are safe or deterministic to run in CI. Verification is `shellcheck`-clean plus a documented manual walkthrough.

## Goals / Non-Goals

**Goals:**
- Deploy failures are unmissable: any failed function deploy makes the script exit non-zero.
- The host's SELinux enforcing state is never left permissive, on any exit path.
- The SELinux workaround is opt-in, not imposed on every operator.
- `PROJECT_REF` resolution does not depend on the exact glyphs/spacing of human-formatted CLI output.
- Secrets are never echoed to the terminal and never word-split/globbed or joined into one process-list argument.
- Scripts name their real filenames.
- Both scripts pass `shellcheck` with zero findings.

**Non-Goals:**
- No automated test harness for the scripts (see Context — unsafe/nondeterministic in CI).
- No non-SELinux platform abstraction beyond making the SELinux path opt-in.
- No changes to migrations, edge functions, `validate-all.sh`, or application code.

## Decisions

### D1 — Fail the deploy on any function failure
Keep the loop-and-collect approach (deploy every function, don't abort on the first failure so the operator sees the full picture), but track `deploy_failed` and `exit 1` at the end if it is set. This preserves "attempt all, report all" while making the exit code honest. *Alternative considered:* abort on first failure — rejected because a partial redeploy is worth completing and reporting in one run.

### D2 — SELinux restore via `trap ... EXIT`
Register a single cleanup function with `trap cleanup EXIT` immediately after switching to permissive. The trap fires on normal exit, `set -e` failure, and SIGINT/SIGTERM, guaranteeing restoration. The cleanup reads a module-level `SELINUX_WAS_ENFORCING` flag so it is a no-op when nothing was changed (idempotent — safe if the trap somehow fires twice). *Alternative considered:* inline restore plus a separate `trap` for signals only — rejected as duplicated logic; a single EXIT trap covers all paths. We also trap SIGINT/SIGTERM explicitly so the enforcing state is restored even though `set -e` alone would not catch a signal.

### D3 — Gate the SELinux workaround behind `TB_SELINUX_WORKAROUND=1`
The workaround is one developer's host policy; silently invoking `sudo setenforce` on every operator's machine is surprising and privileged. Only run it when `TB_SELINUX_WORKAROUND=1`. The default (unset) path does nothing to SELinux and needs no `sudo`. Documented in the script header. This is an intentional behavior change: operators who relied on the automatic behavior must now opt in. *Alternative considered:* auto-detect Qubes/Fedora — rejected as still surprising and still privileged without consent.

### D4 — Resolve `PROJECT_REF` from machine-readable sources
Prefer the CLI's own state file `supabase/.temp/project-ref` (written by `supabase link`). If absent, fall back to `supabase projects list --output json` parsed with a minimal JSON extraction (prefer `jq` if available; otherwise a narrow grep/sed on the JSON, not on decorative output). If still unresolved, exit 1 with the link instruction. This removes the dependency on the `●` glyph and column spacing. *Alternative considered:* keep the awk glyph-match as a last resort — rejected; it is exactly the brittleness we are removing. For the deploy script, `--linked` already targets the linked project for migrations, so the ref is only needed for `functions deploy --project-ref`; reading the temp file is the most direct source.

### D5 — Secret handling: `read -rs` + quoted array
Read each secret with `read -rs` (silent, no backslash mangling) and print a newline afterward (since `-s` suppresses the echo of the Enter key). Build a bash array `SECRETS=("OPENROUTER_API_KEY=$OPENROUTER_API_KEY" "MCP_ACCESS_KEY=$MCP_ACCESS_KEY")` and invoke `npx supabase secrets set "${SECRETS[@]}"`. Array-quoting keeps each `KEY=value` a single argument even if the value contains spaces or shell metacharacters, and avoids the SC2086 word-splitting hazard. *Alternative considered:* `--env-file` temp file — viable but adds temp-file lifecycle/cleanup and a secret-on-disk window; the quoted array is simpler and keeps secrets in-process only. Note the process list still shows the CLI arguments generally, but array-quoting is the fix the fix-plan specifies and prevents the value-splitting/globbing corruption; a stronger `--env-file` approach is deliberately deferred as a non-goal.

### Test Strategy
No automated layer applies (scripts invoke `sudo`, the Supabase CLI, and remote deploys — unsafe/nondeterministic in CI). Verification is:
1. `shellcheck` clean on both scripts (was: 1 SC2086 finding in the setup script; target: zero).
2. `bash -n` syntax check on both.
3. A documented manual walkthrough in `tasks.md` covering: deploy-failure exit code, SELinux gate off/on, interrupt-restores-SELinux, project-ref resolution from the temp file, and no-echo secret entry — each with the observable expectation.

### User error scenarios
- Operator runs deploy without a linked project → resolved ref is empty → exit 1 with link instructions (D4).
- Operator interrupts the deploy while SELinux is permissive → trap restores enforcing (D2).
- Operator on a non-SELinux/non-Qubes host → default path never touches SELinux (D3).
- Operator pastes a secret containing spaces → array-quoting transmits it intact (D5).
- Operator answers "n" to "set secrets now?" → unchanged skip path, prints the manual command.

### Security analysis
Threats addressed: (T1) secret disclosure via terminal echo / shoulder-surf → `read -rs`; (T2) secret corruption/partial-arg injection via word-splitting/globbing → quoted array; (T3) host left in a weakened security posture (SELinux permissive) after an interrupt → EXIT/SIGINT trap; (T4) unprivileged operators being made to run `sudo setenforce` without consent → opt-in env gate. Residual (accepted, documented): CLI arguments are still visible in the process list generally — `--env-file` would close this but is a non-goal for this step.

## Risks / Trade-offs

- [Behavior change: SELinux workaround now opt-in] → An operator who relied on the automatic behavior gets a Docker/volume permission failure on a Fedora/Qubes host. Mitigation: documented in the script header and proposal; the failure is loud (deploy fails, exit 1) and the fix is a one-line env var.
- [`supabase/.temp/project-ref` format could change across CLI versions] → Mitigation: JSON fallback via `--output json`; final fallback exits with an actionable message rather than proceeding with a wrong/empty ref.
- [Process-list exposure of secrets not fully closed] → Accepted and documented; word-splitting corruption and terminal echo (the C11 items) ARE closed.
- [No automated regression test] → Mitigation: `shellcheck` + `bash -n` in the change's verification, and a repeatable documented walkthrough; the fix-plan explicitly accepts this for these scripts.

## Migration Plan

No data or schema migration. Rollout is merging the branch; the only operator-visible change is the new `TB_SELINUX_WORKAROUND=1` opt-in, called out in the script header and PR description. Rollback is reverting the branch — the scripts are self-contained and stateless.

## Open Questions

None. The `--env-file` hardening for process-list exposure is a deliberate non-goal recorded above, not an open question.
