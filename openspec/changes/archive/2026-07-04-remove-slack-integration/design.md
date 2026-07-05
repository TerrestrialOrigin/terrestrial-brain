# Design: Remove Slack Integration

## Context

Thoughts can currently enter the brain three ways: the MCP `capture_thought` tool, the Obsidian plugin's `ingest_note` path, and a Slack channel listener — the `ingest-thought` Supabase Edge Function, which receives Slack Events API webhooks, calls the enhanced-ingest pipeline, and replies in-thread. The Slack path is unused. It also carries open security findings (no request-signature verification, weak content-based dedup — Step 2 of `codeEval/Fable20260704-fix-plan.md`) and holds the service-role key, so it is pure attack surface with zero utility. This change deletes it and every reference to it.

## Goals / Non-Goals

**Goals:**
- Remove the `ingest-thought` Edge Function and all Slack-specific configuration, scripting, and documentation.
- Keep the OpenSpec main specs truthful: drop the `ingest-thought` logging requirement from `function-call-logging`.
- Purge the now-moot Slack items from the forward-looking fix plan so nobody implements a fix for deleted code.
- Document the manual production cleanup (delete the deployed function, unset the secrets).

**Non-Goals:**
- No changes to `capture_thought`, `ingest_note`, or the enhanced-ingest pipeline they share — only the Slack entry point goes away.
- No edit to the unrelated OAuth-provider comment in `supabase/config.toml`.
- No edit to `codeEval/Fable20260704.md` (historical evaluation record).
- No automation of Slack-side cleanup (revoking the bot token / deleting the Slack app is a manual owner action).

## Decisions

### 1. Delete the function outright rather than feature-flagging or archiving it
Git history preserves the code; if Slack capture is ever wanted again it can be resurrected from history or rebuilt against the then-current ingest pipeline. A disabled-but-present function would still show up in deploy scripts, secret checklists, and the threat model, defeating the point.

### 2. Remove (not modify) the spec requirement
The `function-call-logging` capability keeps its table, MCP, HTTP, and IP-extraction requirements untouched. Only the requirement scoped to the deleted function is REMOVED via delta spec, with reason and migration noted. No other main spec references Slack or `ingest-thought`.

### 3. Production cleanup is a documented manual step, not a migration
There is no code artifact that can delete a deployed Edge Function or unset secrets; `docs/upgrade.md` gets the one-time instructions (`npx supabase functions delete ingest-thought`, `npx supabase secrets unset SLACK_BOT_TOKEN SLACK_CAPTURE_CHANNEL`) in place of its current deploy instruction for the function.

### User error scenarios
- **Operator runs the old setup flow expectations:** `scripts/initial-setup-prod.sh` no longer prompts for Slack secrets; an operator pasting old instructions loses nothing — the secrets are simply never requested or set.
- **A Slack webhook still fires at the old endpoint after removal:** Supabase returns 404 for a deleted function; Slack retries a few times and then disables the event subscription. No data loss (the feature is unused) and no service-role exposure (the function no longer exists).
- **Someone follows a stale doc mentioning Slack setup:** all in-repo docs are scrubbed in this change, so the only stale sources are external notes, which the README's env-var table no longer corroborates.

### Security analysis
This change is strictly security-positive: it removes an unauthenticated public webhook endpoint that held the service-role key and lacked signature verification (findings S2 in the code evaluation). `docs/ThreatModel.md` is updated so the trust-boundary section lists only `terrestrial-brain-mcp` as a service-role-key holder; the fix plan's Slack mitigation work is removed as moot. Residual risk: the production function keeps running until the manual deletion step is performed — mitigated by putting that step first in `docs/upgrade.md`.

### API contract
No API changes for the front end / plugin. The MCP surface is untouched; `docs/api-frontend-guide.md` does not exist in this repo and nothing here would belong in it.

### Test Strategy
- **No new tests.** This is a pure removal; no existing unit/integration test touches the Slack path (verified by grep — only `scripts/initial-setup-prod.sh` matched outside docs).
- **Regression layer:** run the full existing integration suite (`tests/integration/`) to prove the MCP function and ingest pipeline are unaffected.
- **Removal verification is by absence:** repo-wide grep for `slack`/`ingest-thought` (case-insensitive) must return only the allowed remnants (config.toml OAuth comment, historical eval record, OpenSpec archive).
- E2E/browser layer does not apply — there is no UI surface in this change.

## Risks / Trade-offs

- [Slack capture wanted again later] → Code is in git history; rebuilding against the shared enhanced-ingest pipeline is straightforward.
- [Deployed function lingers in production after the repo change merges] → Explicit first step in `docs/upgrade.md`; also called out in tasks.md as a human-action reminder.
- [Doc scrub misses a reference] → tasks include a final repo-wide grep gate with an explicit allowlist of intentional remnants.

## Migration Plan

1. Merge this change (repo-side removal).
2. Owner runs, once, against production: `npx supabase functions delete ingest-thought --project-ref <ref>` and `npx supabase secrets unset SLACK_BOT_TOKEN SLACK_CAPTURE_CHANNEL --project-ref <ref>`.
3. Owner optionally deletes/deactivates the Slack app in the workspace.

Rollback: revert the commit and redeploy `ingest-thought`; secrets must be re-set from the owner's vault.

## Open Questions

None.
