# Design: Postpone AI Output Decision

## Approach

### Current behavior

`showConfirmationDialog` returns `Promise<boolean>` — `true` = accept, `false` = reject. The `onClose()` handler in `AIOutputConfirmModal` calls `onDecision(false)` when the user closes without clicking a button, which triggers `rejectOutputs()`.

### New behavior

Change the callback to return a three-state result: `"accepted"`, `"rejected"`, or `"postponed"`.

- **Accept All** → `"accepted"` → fetch content and deliver to vault
- **Reject All** → `"rejected"` → call `reject_ai_output` on the backend
- **Postpone** (button click, Escape, or X) → `"postponed"` → do nothing, outputs remain pending in DB

### Implementation

1. **New type:** `type AIOutputDecision = "accepted" | "rejected" | "postponed"`
2. **`AIOutputConfirmModal`:**
   - Change `onDecision` callback from `(accepted: boolean) => void` to `(decision: AIOutputDecision) => void`
   - Change `resolve(accepted: boolean)` to `resolve(decision: AIOutputDecision)`
   - Accept All button calls `resolve("accepted")`
   - Reject All button calls `resolve("rejected")`
   - New Postpone button calls `resolve("postponed")`
   - `onClose()` calls `onDecision("postponed")` if `!this.resolved` (instead of `onDecision(false)`)
3. **`showConfirmationDialog`:** Returns `Promise<AIOutputDecision>` instead of `Promise<boolean>`
4. **`pollAIOutput`:** Change from `if (accepted)` / `else` to a three-way branch:
   - `"accepted"` → call `fetchAndDeliverOutputs`
   - `"rejected"` → call `rejectOutputs`
   - `"postponed"` → do nothing (fall through to `finally` which resets `pollInProgress`)

## Architecture decisions

This is a pure front-end (plugin) change. The backend already handles the "no action" case correctly — outputs with `picked_up = false AND rejected = false` remain pending and will appear in the next poll.

### User error scenarios

| Error | Handling |
|-------|----------|
| User accidentally postpones when they meant to accept | Outputs reappear on next poll cycle; user can accept then |
| User postpones repeatedly and forgets about outputs | Outputs persist in DB and will keep appearing in polls until acted on |
| User closes dialog mid-review via Escape | Same as postpone — safe default, no data lost |

### Security analysis

No new attack surface. The change removes a destructive default (auto-reject), making the system safer. No new network calls, no new backend tools.

### Test Strategy

- **Unit tests** (Vitest, plugin): Test the three-way decision flow in `pollAIOutput` and the modal's behavior on close/postpone
- No integration or E2E tests needed — this is purely plugin UI logic with no backend changes

## Decisions

- Button order: "Reject All" (left) | "Postpone" (center) | "Accept All" (right, primary CTA). This places the destructive action furthest from the primary action.
- No notice on postpone — the dialog closing is sufficient feedback.
