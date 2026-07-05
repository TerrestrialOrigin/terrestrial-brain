# Remove Slack Integration

## Why

The Slack capture integration (the `ingest-thought` Edge Function) is unused — the owner never captures thoughts via Slack. Keeping it around costs real maintenance: it holds the service-role key, it has open security findings (missing request-signature verification, content-based dedup) queued in the fix plan, and it complicates setup docs and the production setup script with optional secrets. Removing it shrinks the attack surface and the setup burden to zero for a feature nobody uses.

## What Changes

- **BREAKING (removal):** Delete the `ingest-thought` Supabase Edge Function (`supabase/functions/ingest-thought/`). Thought capture via Slack messages is no longer supported; capture continues to work through the MCP `capture_thought` tool and the Obsidian plugin ingest path.
- Remove `SLACK_BOT_TOKEN` / `SLACK_CAPTURE_CHANNEL` prompting and secret-setting from `scripts/initial-setup-prod.sh`, and the `ingest-thought` deploy step from setup/upgrade flows.
- Remove Slack/`ingest-thought` references from `README.md`, `docs/fresh-install.md`, `docs/upgrade.md`, and `docs/ThreatModel.md` (the threat model's trust-boundary description lists `ingest-thought` as a service-role-key holder).
- Remove the `ingest-thought` logging requirement from the `function-call-logging` spec (`openspec/specs/function-call-logging/spec.md`) via a delta spec.
- Remove all Slack-related items from `codeEval/Fable20260704-fix-plan.md`: Step 2 (`bug/SlackSignatureVerification`), its checklist entry, and the Slack ingest file reference — those fixes are moot once the function is gone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `function-call-logging`: The requirement "Ingest-thought function invocations are logged" (and its scenarios) is REMOVED — the `ingest-thought` function ceases to exist, so there is nothing to log. Logging requirements for the MCP function are unchanged.

## Non-goals

- No changes to the MCP capture path (`capture_thought`, `ingest_note`) — capture functionality itself stays.
- No removal of the unrelated Slack mention in `supabase/config.toml` line ~304 — that is a stock comment listing Supabase OAuth providers, not part of this integration.
- No changes to `codeEval/Fable20260704.md` — that file is the historical record of the code evaluation findings and stays as-is; only the forward-looking fix plan is edited.
- No revocation tooling for existing Slack app credentials — deactivating the Slack app/bot token in the Slack workspace is a manual owner action (noted in tasks as a reminder, not automated).

## Impact

- **Code:** `supabase/functions/ingest-thought/` deleted.
- **Scripts:** `scripts/initial-setup-prod.sh` no longer prompts for or sets Slack secrets.
- **Docs:** `README.md`, `docs/fresh-install.md`, `docs/upgrade.md`, `docs/ThreatModel.md`, `codeEval/Fable20260704-fix-plan.md` updated.
- **Specs:** `openspec/specs/function-call-logging/spec.md` loses one requirement.
- **Deployed systems:** The already-deployed `ingest-thought` function in the Supabase project should be deleted (`npx supabase functions delete ingest-thought`) and the `SLACK_BOT_TOKEN` / `SLACK_CAPTURE_CHANNEL` secrets unset — documented as a manual/upgrade step.
- **Tests:** No existing tests reference the Slack integration, so no test deletions; integration suite must still pass.
