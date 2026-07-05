# Verification — harden-prod-scripts

These scripts have **no automated test suite** (they invoke `sudo`, the Supabase CLI, and remote deploys — unsafe and nondeterministic in CI, as recorded in design.md → Test Strategy). Verification is therefore: (1) `shellcheck` clean, (2) `bash -n` clean, and (3) a documented controlled walkthrough in an isolated sandbox with stubbed `npx`/`sudo`/`getenforce`/`jq`. All were performed on branch `bug/ProdScriptsHardening`.

## Static checks

| Check | deploy-update-prod.sh | initial-setup-prod.sh |
| --- | --- | --- |
| `shellcheck` (v0.10.0) | 0 findings | 0 findings (baseline had 1× SC2086 — now gone) |
| `bash -n` | clean | clean |
| `grep -rn 'deploy-prod.sh' scripts/` | no matches (stale name removed) | no matches |

## Controlled walkthrough (stubbed CLI/sudo/SELinux)

Run in a sandbox with fake `supabase/functions/{func-a,func-b}`, a stub `npx supabase`, a stub `sudo` that logs its args, and a stub `getenforce` returning `Enforcing`.

| # | Scenario | Expectation | Result |
| --- | --- | --- | --- |
| a | A function deploy fails (`func-b`) | Script prints ERROR and exits **1** | ✅ exit 1, both funcs attempted |
| a2 | All functions deploy | Script prints "Deploy complete", exits **0** | ✅ exit 0 |
| b | `TB_SELINUX_WORKAROUND` unset | No `sudo`/`setenforce` call at all | ✅ 0 sudo calls |
| c | Workaround `=1`, normal completion | `setenforce 0` then `setenforce 1` (restore) | ✅ 0 then 1 |
| c2 | Workaround `=1`, a deploy fails | SELinux restored **before** the `exit 1` | ✅ 0 then 1, exit 1 |
| c3 | Workaround `=1`, **SIGINT** mid-deploy | INT trap → exit 130, EXIT trap restores enforcing, no "complete" | ✅ exit 130, sudo 0 then 1, did not report complete |
| d | `supabase/.temp/project-ref` present | Ref read from file, no glyph scraping | ✅ `test-file-ref` |
| d2 | Temp file absent, `jq` available | Ref from `projects list --output json` | ✅ `stub-json-ref` |
| d3 | Temp file absent, no `jq` (grep/sed) | Ref parsed from JSON without jq | ✅ `stub-json-ref` |
| d4 | No linked project resolvable | Actionable error + exit **1** | ✅ exit 1 |
| e | Setup: secret with spaces + `*` glob | Passed as ONE intact `KEY=value` arg (no word-split/glob) | ✅ `MCP_ACCESS_KEY=secret with spaces *and glob` |

Scenario **e** is the C11 security fix: under the old unquoted `$SECRETS`, a value with spaces would split into extra arguments and `*` would glob against the CWD. The quoted array `"${SECRETS[@]}"` keeps each `KEY=value` a single argument. Terminal echo suppression uses `read -rsp` (verified present; `-s` is a terminal property not observable through a pipe).
