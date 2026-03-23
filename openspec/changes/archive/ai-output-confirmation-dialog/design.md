## Context

The Obsidian plugin currently polls `get_pending_ai_output` on an interval and immediately writes all returned files to the vault, then marks them as picked up. There is no user confirmation step and no way to reject output. This creates a trust gap: any AI client with MCP access can silently write arbitrary files to the user's vault.

The current flow:
1. Plugin polls `get_pending_ai_output` → gets JSON array of pending outputs
2. For each output: creates parent folders, writes file, stores hash
3. Calls `mark_ai_output_picked_up` with all IDs
4. Shows a Notice: "N AI output(s) delivered to vault"

## Goals / Non-Goals

**Goals:**
- Give the user visibility into what AI outputs are about to be written before they land in the vault
- Allow the user to reject an entire batch of pending outputs
- Preserve rejected outputs in the database for audit purposes (not deleted)
- Keep the UX simple: one dialog, accept all or reject all

**Non-Goals:**
- Per-item accept/reject UI (checkboxes for individual items)
- Automatic size limits or rejection rules
- Changes to AI output creation (`create_ai_output`, `create_tasks_with_output`)
- Changes to the manual "Pull AI output" command behavior (it will also show the dialog)

## Decisions

### 1. Confirmation dialog using Obsidian's Modal API

Use Obsidian's built-in `Modal` class to show a confirmation dialog. This is the standard Obsidian way to present blocking user interactions, is well-documented, and doesn't require any external UI library.

The modal displays:
- Header: "N pending AI output(s)"
- A list of each output: file path and character count (e.g., `projects/CarChief/plan.md — 2,340 chars`)
- Two buttons: "Accept All" and "Reject All"

**Alternative considered:** Using Obsidian's `Notice` with clickable actions. Rejected because Notices are transient and don't block — the user could miss them, defeating the purpose.

### 2. Add `rejected` and `rejected_at` columns to `ai_output`

Add two nullable columns:
- `rejected` (boolean, NOT NULL, default false) — whether the user rejected this output
- `rejected_at` (timestamptz, nullable) — when the rejection happened

**Why not delete rejected rows?** Keeping them provides an audit trail. If a prompt injection attack floods the queue, the user (or an AI) can later inspect what was rejected and trace the source via `source_context`.

**Why not a `status` enum column?** The current `picked_up` boolean is already in production and works. Adding `rejected` as a separate boolean keeps the schema additive (no migration of existing data needed) and avoids coupling the two concerns. A row can be: pending (`picked_up=false, rejected=false`), delivered (`picked_up=true`), or rejected (`rejected=true`). These states are mutually exclusive in practice.

### 3. New `reject_ai_output` MCP tool

Add a dedicated MCP tool rather than overloading `mark_ai_output_picked_up` with a "reject" flag. Reasons:
- Clearer intent in the tool name — AIs reading tool descriptions understand rejection is a distinct action
- The `mark_ai_output_picked_up` tool is documented as plugin-internal; mixing rejection into it muddies the API
- Keeps each tool doing one thing

### 4. Update `get_pending_ai_output` filter

The query currently filters `WHERE picked_up = false`. Update to `WHERE picked_up = false AND rejected = false`. The existing partial index on `picked_up` should be replaced with a composite partial index on `(picked_up, rejected) WHERE picked_up = false AND rejected = false`.

### 5. Dialog shown for both automatic polls and manual pulls

Both the interval-based poll and the manual "Pull AI output" command go through the same `pollAIOutput()` method. The confirmation dialog is added inside this method, so it applies uniformly. If there are no pending outputs, no dialog is shown (current silent behavior preserved).

### Test Strategy

- **Unit tests:** Test the `reject_ai_output` MCP tool, updated `get_pending_ai_output` filter, and database constraints
- **Integration tests (pgTAP):** Verify rejected rows are excluded from pending queries, partial index behavior
- **E2E tests:** Not applicable — the Obsidian Modal UI cannot be driven by Playwright in a meaningful way. Manual testing covers the dialog interaction.

## Risks / Trade-offs

- **[UX interruption]** The dialog appears on every poll where pending output exists, which could be annoying if the user is in flow. → Mitigation: The poll interval is 10 minutes by default, so this is infrequent. The dialog is also quick to dismiss.
- **[Race condition]** If two poll cycles overlap (unlikely with 10-min interval), the same outputs could appear in two dialogs. → Mitigation: The plugin already serializes polls (no concurrent calls). The second poll would see the items already picked up or rejected.
- **[Rejected outputs accumulate]** Rejected rows stay in the table forever. → Acceptable for now; a future cleanup tool can be added if the table grows. The partial index ensures they don't impact query performance.

## Migration Plan

1. Create migration adding `rejected` and `rejected_at` columns with defaults (no data migration needed — existing rows get `rejected = false`)
2. Deploy edge function changes (`reject_ai_output` tool, updated `get_pending_ai_output` filter)
3. Build and deploy updated Obsidian plugin with confirmation dialog
4. Rollback: revert plugin to previous version; the new columns are harmless if unused
