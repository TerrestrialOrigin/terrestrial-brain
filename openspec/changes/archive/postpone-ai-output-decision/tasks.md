# Tasks: Postpone AI Output Decision

## Group 1: Plugin Implementation

- [x] Add `AIOutputDecision` type alias to `main.ts`
- [x] Update `AIOutputConfirmModal` to use three-state callback
- [x] Update `onClose()` to resolve as `"postponed"` instead of `false`
- [x] Add "Postpone" button to the dialog UI
- [x] Update `showConfirmationDialog` return type to `Promise<AIOutputDecision>`
- [x] Update `pollAIOutput` to handle three-way branch (accepted/rejected/postponed)

## Group 2: Testing & Verification

- [x] Update existing acceptance test to use `"accepted"` instead of `true`
- [x] Update existing rejection test to use `"rejected"` instead of `false`
- [x] Add new test: postpone does not call fetch or reject
- [x] Add new test: postpone does not show any notice
- [x] Run all tests and verify 0 failures, 0 skips
