## 1. Deploy script — `scripts/deploy-update-prod.sh`

- [x] 1.1 Fix the stale usage comment: `./scripts/deploy-prod.sh` → `./scripts/deploy-update-prod.sh`.
- [x] 1.2 Replace the `awk`/`●`-glyph `PROJECT_REF` resolution with a machine-readable resolver: read `supabase/.temp/project-ref`; fall back to `supabase projects list --output json` (via `jq` if present, else a narrow JSON parse); keep the empty-ref → `exit 1` with link instructions.
- [x] 1.3 Gate the SELinux workaround behind `TB_SELINUX_WORKAROUND=1`: only detect/switch when the flag is `1`; document the flag in the script header comment.
- [x] 1.4 Move the SELinux restore into a `cleanup` function registered with `trap cleanup EXIT` (plus `trap cleanup INT TERM`), keyed on `SELINUX_WAS_ENFORCING` so it is idempotent and a no-op when unchanged. Remove the inline restore.
- [x] 1.5 Make the deploy loop honest: keep collecting `deploy_failed=true` on any failed function, and add `exit 1` at the end when `deploy_failed` is set (after the trap-restored SELinux and the status output).

## 2. Setup script — `scripts/initial-setup-prod.sh`

- [x] 2.1 Fix the stale next-steps output: `Use deploy-prod.sh for future updates` → `deploy-update-prod.sh`.
- [x] 2.2 Read `OPENROUTER_API_KEY` and `MCP_ACCESS_KEY` with `read -rs` (silent) and emit a trailing newline after each prompt.
- [x] 2.3 Build a quoted bash array `SECRETS=("OPENROUTER_API_KEY=$OPENROUTER_API_KEY" "MCP_ACCESS_KEY=$MCP_ACCESS_KEY")` and invoke `npx supabase secrets set "${SECRETS[@]}" --project-ref "$PROJECT_REF"`; remove the unquoted `$SECRETS` word-splitting.

## 3. Testing & Verification

- [x] 3.1 `shellcheck` both scripts — zero findings (baseline had one SC2086 in the setup script; confirm it is gone and no new findings appear).
- [x] 3.2 `bash -n` syntax check on both scripts — clean.
- [x] 3.3 Documented manual walkthrough (no automated suite for these scripts): verify (a) deploy exits 1 when a function deploy fails; (b) with `TB_SELINUX_WORKAROUND` unset, no `setenforce`/`sudo` path runs; (c) with the flag set and an interrupt, the EXIT/INT trap restores enforcing; (d) `PROJECT_REF` resolves from `supabase/.temp/project-ref`; (e) secret prompts do not echo. Record the walkthrough and expectations in the change.
- [x] 3.4 Confirm no reference to the non-existent `deploy-prod.sh` remains: `grep -rn "deploy-prod.sh" scripts/` returns nothing.
- [x] 3.5 Update the fix-plan progress checklist (Step 13) to checked.
