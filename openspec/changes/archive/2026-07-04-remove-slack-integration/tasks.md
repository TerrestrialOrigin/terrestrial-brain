# Tasks: Remove Slack Integration

## 1. Code & Script Removal

- [x] 1.1 Delete `supabase/functions/ingest-thought/` (entire directory)
- [x] 1.2 Remove `SLACK_BOT_TOKEN` / `SLACK_CAPTURE_CHANNEL` prompting, secret assembly, and related echo lines from `scripts/initial-setup-prod.sh`; remove any `ingest-thought` deploy step
- [x] 1.3 Check `supabase/config.toml` for an `ingest-thought` function block and remove it if present (leave the unrelated OAuth-provider comment untouched)

## 2. Documentation Scrub

- [x] 2.1 `README.md`: remove the `ingest-thought` entry from the architecture tree, the "Optional -- if you want Slack integration" setup block, and the `SLACK_BOT_TOKEN` / `SLACK_CAPTURE_CHANNEL` rows from the env-var table
- [x] 2.2 `docs/fresh-install.md`: remove Slack secret lines from the secrets-set command, the two `SLACK_*` variable descriptions, and the "If you're not using the Slack integration" note
- [x] 2.3 `docs/upgrade.md`: replace the `ingest-thought` deploy instruction with one-time removal instructions (`npx supabase functions delete ingest-thought`, `npx supabase secrets unset SLACK_BOT_TOKEN SLACK_CAPTURE_CHANNEL`)
- [x] 2.4 `docs/ThreatModel.md`: remove `ingest-thought` from the service-role-key holders list and any other Slack-related threat entries
- [x] 2.5 `codeEval/Fable20260704-fix-plan.md`: remove the Slack ingest file reference (line ~22), all of "Step 2: Slack request-signature verification on ingest-thought", and checklist item "2. Slack signature verification"; renumber only if the document's structure requires it (prefer leaving other step numbers stable and noting the removal)

## 3. Spec Sync

- [x] 3.1 Delta spec `specs/function-call-logging/spec.md` in this change is complete (REMOVED requirement) — verify it validates via `openspec validate`

## 4. Testing & Verification

- [x] 4.1 Repo-wide case-insensitive grep for `slack` and `ingest-thought` returns only allowed remnants: `supabase/config.toml` OAuth comment, `codeEval/Fable20260704.md` (historical record), `openspec/changes/archive/**`, and this change's own artifacts
- [x] 4.2 Run the full integration test suite (`tests/integration/`) with the local stack up — 0 failures, 0 skips
- [x] 4.3 Run the project's validate script if present (`npm run validate` / `scripts/validate-all.sh`) — passes
- [x] 4.4 Bash-syntax-check the edited setup script: `bash -n scripts/initial-setup-prod.sh`
- [x] 4.5 Remind the owner of the manual production step: delete the deployed `ingest-thought` function and unset the two Slack secrets (documented in `docs/upgrade.md`)
