## Why

The AI output delivery pipeline currently writes files to the Obsidian vault silently — no user confirmation, no size checks, no ability to reject. A malicious or prompt-injected AI (or a compromised MCP endpoint) could flood the vault with thousands of files or a single massive note, consuming disk space and polluting the knowledge base. The user has no visibility into what's being written until after the damage is done.

## What Changes

- Add a **confirmation dialog** to the Obsidian plugin that appears when AI output is polled and pending items exist. The dialog shows:
  - Total number of pending outputs at the top
  - Each output listed with its full file path and character count
- The user can **Accept All** (proceed with delivery) or **Reject All** (discard the batch)
- Add a `rejected` boolean column to the `ai_output` table so rejected outputs are marked and excluded from future polls (they are not deleted — preserving an audit trail)
- Update the `mark_ai_output_picked_up` MCP tool (or add a new `reject_ai_output` tool) to support marking outputs as rejected
- Update `get_pending_ai_output` to exclude rejected rows

## Non-goals

- Per-item accept/reject (user feedback is all-or-nothing for the batch)
- Size limits or automatic rejection rules (this change adds visibility and manual control; automated safeguards can be layered on later)
- Changes to how AI output is created — `create_ai_output` and `create_tasks_with_output` are unchanged

## Capabilities

### New Capabilities
- `ai-output-confirmation`: User-facing confirmation dialog in the Obsidian plugin for reviewing and accepting/rejecting pending AI output before it is written to the vault

### Modified Capabilities
- `ai-output`: The `ai_output` table gains a `rejected` column; `get_pending_ai_output` excludes rejected rows; a new `reject_ai_output` MCP tool is added (see `openspec/specs/ai-output.md`)
- `obsidian-plugin`: The polling flow changes from silent write to confirmation-gated write (see `openspec/specs/obsidian-plugin.md`)

## Impact

- **Database:** New migration adding `rejected` (boolean, default false) and `rejected_at` (timestamptz, nullable) columns to `ai_output`
- **Edge function:** New `reject_ai_output` MCP tool; `get_pending_ai_output` query filter updated
- **Obsidian plugin:** New Modal subclass for the confirmation dialog; `pollAIOutput()` refactored to show dialog before writing
- **No breaking changes** to existing AI clients — `create_ai_output` and `create_tasks_with_output` are unchanged
