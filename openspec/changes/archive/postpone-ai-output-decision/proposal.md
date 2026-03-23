# Proposal: Postpone AI Output Decision

## What

Change the AI output confirmation dialog so that closing it (Escape, X button, or new "Postpone" button) does **not** reject pending outputs. Outputs should only be accepted or rejected when the user explicitly clicks "Accept All" or "Reject All". Add a "Postpone Decision" button for clarity.

## Motivation

Currently, pressing Escape or clicking the X on the confirmation dialog auto-rejects all pending AI outputs. This is problematic because users may want to postpone the decision — they might not have time to review now, or they want to check something first. The destructive default (reject on close) can cause unintended data loss.

## Scope

- **Plugin modal (`AIOutputConfirmModal`):** Change `onClose()` to not auto-reject; change callback type from boolean to a three-state enum (accepted/rejected/postponed)
- **Plugin poll logic (`pollAIOutput`):** Handle the postpone case by doing nothing (outputs remain pending in DB)
- **Plugin UI:** Add "Postpone" button to the dialog
- **Tests:** Update existing tests, add new test for postpone behavior

## Non-goals

- No backend/MCP/database changes — outputs already remain pending when no action is taken
- No per-item accept/reject — still all-or-nothing
- No changes to auto-poll interval or manual pull behavior

## Affected specs

- `openspec/specs/ai-output-confirmation/spec.md`
