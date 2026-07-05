## 1. Failing-first tests (bug replication)

- [x] 1.1 C1: add a vitest that runs the REAL vault-sync loop through the REAL `processNote` with `callIngestNote` rejecting for all files, asserting a failure Notice (not "Vault sync complete"). Confirm it FAILS against current code.
- [x] 1.2 C10: add a vitest exercising the REAL `saveSettings`/persistence + poll-interval application, asserting the interval is NOT restarted when `pollIntervalMinutes` is unchanged and IS restarted when it changes. Confirm it FAILS against current code.

## 2. C1 — processNote outcome + honest vault-sync counts

- [x] 2.1 Add a `SyncOutcome = "synced" | "skipped" | "failed"` type and make `processNote` return it for every branch (excluded/no-endpoint/empty/unchanged → `"skipped"`; success → `"synced"`; caught ingest error → `"failed"`).
- [x] 2.2 Rewrite the entire-vault sync command to count `done`/`failed` from the returned outcome and show a failure Notice whenever any note failed.

## 3. C10 — split persistence from side effects

- [x] 3.1 Add `persistData()` (writes settings + `syncedHashes` via `saveData`); repoint `saveSettings` and all non-interval save sites at it so persistence never restarts the interval.
- [x] 3.2 Add `appliedPollIntervalMinutes` tracking and an `applyPollInterval()` that clears+re-registers the interval only when the value changed; call it from `onload` and the settings-tab poll-interval `onChange` only.

## 4. B3 — crash-safe debounce + vault delete/rename

- [x] 4.1 Wrap the `scheduleSync` timer-body in try/catch; guard `vault.read` in `processNote` so a vanished file returns `"skipped"` instead of throwing.
- [x] 4.2 Register `vault.on("delete")` → cancel timer + drop `syncedHashes[path]` + `persistData()`.
- [x] 4.3 Register `vault.on("rename")` → cancel old-path timer + move `syncedHashes[oldPath]`→`newPath` + `persistData()`.

## 5. B5 — capped-backoff retry for scheduled syncs

- [x] 5.1 Add `MAX_RETRY_ATTEMPTS` and `MAX_RETRY_DELAY_MS` constants; thread an `attempt` count through `scheduleSync`; on scheduled failure re-schedule with `min(base*2**attempt, MAX_RETRY_DELAY_MS)` until the cap. Manual/forced syncs do not auto-retry.
- [x] 5.2 Document the retry behavior in the sync-delay setting description.

## 6. B4 — surface manual pull failures

- [x] 6.1 In `pollAIOutput`'s catch, show a (truncated) Notice when `options.manual` is true; keep `console.error` for the full error; stay silent for automatic polls.

## 7. Plugin S4 — bounded, sanitized error notices

- [x] 7.1 Add `truncateForNotice(text, max=300)` (collapse whitespace + ellipsis); apply it to the response body inside the `callHTTP` and `callIngestNote` thrown-error messages. Keep full detail in `console.error`.

## 8. Testing & Verification

- [x] 8.1 Make the failing-first C1 and C10 tests pass; confirm GATE 2b (deleting each fix reddens its test).
- [x] 8.2 Add tests for B3 (delete/rename handlers, debounce read-rejection), B5 (retry backoff + cap, no manual retry), B4 (manual-pull Notice, silent auto-poll), and S4 (`truncateForNotice` + truncated thrown messages).
- [x] 8.3 Run the full plugin vitest suite — zero failures, zero skips — and `npm run build` (obsidian-plugin), showing the summary line.
- [x] 8.4 Run the Deno suite as a regression gate (`deno task test`) OR document why it's unaffected/unavailable per the step's plugin-only scope; `/opsx:verify` then `/opsx:archive`; update the fix-plan checklist for Step 12.
