## 1. Utility: Copy Path Generation

- [x] 1.1 Implement `generateCopyPath(path, existsCheck)` — takes a vault-relative path and an async `exists` function, returns the first available `Filename(N).md` path starting at N=2, capped at 100 attempts
- [x] 1.2 Export `generateCopyPath` for testability

## 2. Types and Data Structures

- [x] 2.1 Add `ConflictInfo` type: `Record<string, boolean>` mapping output ID to whether its `file_path` conflicts with an existing vault file
- [x] 2.2 Add `ConflictResolution` type: `Map<string, "overwrite" | "rename">` mapping conflicting output IDs to the user's chosen resolution
- [x] 2.3 Refactor `showConfirmationDialog` return type to include both the decision and the conflict resolutions map

## 3. Conflict Detection in pollAIOutput

- [x] 3.1 After fetching metadata, check `this.app.vault.adapter.exists(path)` for each output's `file_path` and build a `ConflictInfo` record
- [x] 3.2 Pass `ConflictInfo` into `showConfirmationDialog` and onwards to `AIOutputConfirmModal`

## 4. Enhanced Confirmation Dialog

- [x] 4.1 Update `AIOutputConfirmModal` constructor to accept `ConflictInfo`
- [x] 4.2 For conflicting files: display a conflict indicator ("overwrites existing") and a dropdown with "Overwrite" / "Save as copy" (default: "Overwrite")
- [x] 4.3 For non-conflicting files: display a "new file" indicator, no dropdown
- [x] 4.4 Collect per-file resolutions into a `ConflictResolution` map and return it alongside the decision

## 5. Conflict-Aware File Writing

- [x] 5.1 Update `fetchAndDeliverOutputs` to accept `ConflictResolution` map
- [x] 5.2 For outputs where resolution is "rename": call `generateCopyPath` to get the write path
- [x] 5.3 Store hash in `syncedHashes` under the actual written path (original or renamed)
- [x] 5.4 Handle `generateCopyPath` failure: skip that file, show error Notice, continue with remaining files

## 6. Testing & Verification

- [x] 6.1 Unit tests for `generateCopyPath`: basic rename, incremented suffix, root-level file, safety cap error
- [x] 6.2 Unit tests for conflict detection: builds correct `ConflictInfo` from exists checks
- [x] 6.3 Unit tests for modal: conflict info passed through to dialog, resolutions flow back to file writing (tested via pollAIOutput flow — modal is a private class with minimal DOM mock)
- [x] 6.4 Unit tests for file writing: overwrite path unchanged, rename path uses copy, hash stored under actual path
- [x] 6.5 Unit test for rename failure: file skipped, remaining files delivered
- [x] 6.6 E2E test: N/A — Obsidian plugin runs in desktop app, no Playwright infrastructure; covered by unit tests that exercise the full pollAIOutput → write flow
- [x] 6.7 E2E test: N/A — same as 6.6; rename flow fully tested at unit level with mocked vault adapter
- [x] 6.8 Run full cross-package test suite and verify 0 failures, 0 skips — plugin tests: 49 passed, 0 failed, 0 skipped; integration tests: pre-existing Deno import failure on develop (unrelated to this change)
