## Context

The Obsidian plugin (`obsidian-plugin/src/main.ts`, ~920 lines, single file) watches the vault, debounce-syncs notes to the brain, and polls for AI output. Six reliability defects were flagged in the code eval (C1, C10, B3, B4, B5, plugin S4). They share a root cause: outcomes are not propagated — errors are logged and swallowed, side effects are triggered unconditionally, and lifecycle events (delete/rename) are unhandled.

Current relevant behavior:
- `processNote` (`main.ts:341-383`) catches its own errors, logs them, shows a Notice only when not silent, and **returns nothing**. The vault-sync command (`main.ts:115-130`) wraps `processNote` in `try/catch { failed++ }` — but since `processNote` never throws, `failed` is always 0 and the success notice always shows.
- `saveSettings` (`main.ts:528-536`) writes to disk **and** calls `startPollInterval()` every time. It is called after every sync, every delivery, and every settings-field keystroke — so the poll interval is torn down and rebuilt constantly, and its next fire is pushed out indefinitely under normal editing.
- `scheduleSync`'s timer callback (`main.ts:211-214`) `await`s `processNote` with no try/catch; `processNote` reads the file via `vault.read`. If the file was deleted during the 5-minute delay, `vault.read` rejects with no handler. There is no `delete`/`rename` event handler, so a renamed file keeps a stale timer and a stale hash under the old path.
- `pollAIOutput({ manual: true })` (`main.ts:259-260`) catches errors into `console.error` only — a manual pull that fails is silent to the user.
- A scheduled sync that fails is not retried; the note stays unsynced until the next manual edit.
- `callHTTP`/`callIngestNote` throw `Error(`HTTP ${status}: ${rawBody}`)` and `processNote` surfaces `err.message` verbatim in a Notice — an arbitrarily long raw server body (potentially an HTML error page or stack trace) is shown to the user.

Constraints: This change is plugin-only (no server changes) and must not modularize `main.ts` (that is Step 21). Tests are vitest; per the bug-fix rule, C1 and C10 need failing-first tests that exercise the **real** `processNote`/`saveSettings` implementations (the existing suite mocked `saveSettings`, which is exactly why C10 was invisible).

## Goals / Non-Goals

**Goals:**
- `processNote` returns a discriminated outcome; vault-sync counts real failures.
- `saveSettings` is side-effect-free persistence; poll interval restarts only when `pollIntervalMinutes` changed.
- Debounce timer body is crash-safe; vault `delete`/`rename` are handled (timer + hash).
- Manual pull failures show a Notice.
- Failed scheduled syncs retry with capped backoff.
- Error notices show a bounded, sanitized message.

**Non-Goals:**
- Splitting `main.ts` into modules (Step 21).
- Persistent/offline retry across Obsidian restarts (B5 is in-memory only).
- Any edge-function, database, or dependency change.

## Decisions

### D1 — `processNote` returns `SyncOutcome = "synced" | "skipped" | "failed"`
`processNote` returns a string outcome and no longer swallows failure silently. `"skipped"` covers excluded files, no endpoint configured, empty content, and unchanged-hash short-circuits. `"failed"` is returned when `callIngestNote` throws. It still shows the per-note Notice when `!silent` (preserving single-note UX), but the **caller** decides how to aggregate.
- *Alternative considered:* rethrow when `silent` and let the caller's `catch` count. Rejected: a thrown error forces every caller into try/catch and conflates "excluded/skipped" with "failed". A return value distinguishes all three and keeps the vault loop simple. The vault command counts `outcome === "failed"` and treats `synced`/`skipped` as non-failures (with `synced` vs `skipped` both surfaced in the summary).

### D2 — Split persistence from side effects
Introduce `persistData()` (writes settings + `syncedHashes` via `saveData`) as the pure persistence primitive. `saveSettings()` becomes `persistData()` — no interval restart. Interval (re)start moves to an explicit `applyPollInterval()` that compares the new `pollIntervalMinutes` against the currently-applied value and only tears down/rebuilds when it changed. The settings-tab poll-interval `onChange` calls `persistData()` then `applyPollInterval()`; all other `saveSettings()` call sites (`processNote`, `fetchAndDeliverOutputs`, `loadSettings`, other settings fields) call `persistData()` and never touch the timer.
- *Alternative considered:* keep a single `saveSettings` but guard the restart with a changed-check inside it. Rejected: `saveSettings` has no clean way to know "did the interval setting change" without threading state; separating the two responsibilities is the code-quality-directive fix (short, single-purpose functions) and makes the changed-check live exactly where the setting is edited.

### D3 — Track the applied interval value
Store `appliedPollIntervalMinutes: number | null` on the plugin. `applyPollInterval()` no-ops when the requested value equals the applied value; otherwise clears the old interval (via the tracked `pollIntervalId`) and registers a new one, updating both fields. This is what prevents stale interval accumulation.

### D4 — Crash-safe debounce + vault delete/rename handlers
The `setTimeout` callback in `scheduleSync` wraps its body in try/catch; on error it logs and (D6) schedules a retry. Register `vault.on("delete")` → `cancelTimer(path)` + delete `syncedHashes[path]` + `persistData()`. Register `vault.on("rename")` → cancel timer for the old path, move `syncedHashes[oldPath]` to the new path if present, `persistData()`. `processNote` also guards `vault.read` so a race (file vanished between event and read) returns `"skipped"` rather than throwing.
- *Alternative considered:* check `vault.getAbstractFileByPath` before reading. Rejected: still racy; try/catch around the actual read is the reliable guard. Both are cheap so we do the existence-tolerant catch.

### D5 — Bounded, sanitized error text
Add `truncateForNotice(text, max = 300)` that collapses whitespace and truncates with an ellipsis. `callHTTP`/`callIngestNote` apply it to the response body inside the thrown `Error` message; `processNote` already surfaces `err.message`. Full untruncated detail still goes to `console.error`.
- *Alternative considered:* strip the body entirely and show only the status code. Rejected: a short body ("content is required") is genuinely useful; truncation keeps the signal while bounding worst case.

### D6 — Capped-backoff retry for scheduled syncs
`scheduleSync(file, attempt = 0)`. On a **scheduled** (non-manual) failure, if `attempt < MAX_RETRY_ATTEMPTS` (3), re-schedule via `scheduleSync(file, attempt + 1)` with delay `min(baseDelay * 2**attempt, MAX_RETRY_DELAY_MS)` where `baseDelay = syncDelayMinutes * 60000`. Manual syncs (`force`) do not auto-retry (the user is present and sees the Notice). The retry cap and behavior are documented in the sync-delay setting description.
- *Trade-off:* retries are in-memory only; an Obsidian restart drops the pending retry, but the note's hash is unchanged so the next edit re-syncs — acceptable for a non-critical PKM sync. Recorded as a Risk.

### Test Strategy
All layers here are the plugin **vitest** suite (`obsidian-plugin/src/main.test.ts`); this change touches no Deno/edge code, so the Deno integration suite is unaffected (it must still pass unchanged as a regression gate). Per the bug-fix rule:
- **C1 (failing-first):** mock `callIngestNote` to reject for all files, run the real vault-sync loop through the real `processNote`, assert a **failure** notice — must fail against current code (which shows success).
- **C10 (failing-first):** exercise the **real** `saveSettings`/`persistData`/`applyPollInterval` (not the mocked `saveSettings` the current tests use); assert the poll interval is NOT restarted when `pollIntervalMinutes` is unchanged, and IS restarted when it changes. Must fail against current unconditional-restart code.
- **B3:** unit tests for the delete handler (timer cancelled, hash removed), rename handler (hash re-keyed), and a debounce callback whose `vault.read` rejects (no unhandled rejection; retry scheduled).
- **B4:** manual `pollAIOutput({ manual: true })` with `callHTTP` rejecting → a Notice is shown.
- **B5:** a scheduled `processNote` failure schedules a retry with a larger delay; caps at `MAX_RETRY_ATTEMPTS`; manual failure does not retry.
- **Plugin S4:** `callHTTP`/`callIngestNote` with an oversized raw body → thrown message is truncated; `truncateForNotice` unit tests.
- **Regression:** the full existing vitest suite stays green; `npm run build` succeeds.

### User Error Scenarios
- User deletes/renames a note during the debounce window → no crash; timer cancelled / hash re-keyed (D4).
- User rapidly edits the poll-interval field → each keystroke persists but only a real value change restarts the timer (D2/D3); no interval leak.
- User triggers a full-vault sync while offline / endpoint down → every note fails; the final notice reports the failure count instead of false success (C1).
- User triggers a manual pull while the endpoint is down → a Notice explains the failure (B4).
- User configures no access key / wrong key → server 401; the (now truncated) error surfaces in a Notice.

### Security Analysis
- **Information disclosure via Notice (plugin S4):** a malicious or misconfigured endpoint could return a large body / reflected content shown verbatim to the user. Mitigation: `truncateForNotice` bounds length and collapses whitespace before display; full detail stays in `console.error` (dev console, not the note surface). No new secret handling is introduced; the access key continues to travel only in the `x-brain-key` header (Step 3). No new network surface, no new persisted data. Retry (B5) is bounded (max attempts + max delay) so a persistent failure cannot become a tight request loop / self-DoS against the endpoint.

## Risks / Trade-offs

- **In-memory retry lost on restart (B5)** → Mitigation: hash is unchanged on failure, so the next edit re-syncs; documented in the settings description. Acceptable for non-critical sync.
- **Changed-check on interval could drift from actual timer if a code path forgets `applyPollInterval`** → Mitigation: single tracked `appliedPollIntervalMinutes`; only the settings-tab poll-interval field and `onload` call `applyPollInterval`; all others use `persistData`.
- **`processNote` return-type change is a behavior contract** → Mitigation: existing callers ignore the return value today; adding a return is backward-compatible. Tests pin the outcome values.

## Migration Plan

No data or settings migration. Pure code change to the plugin. Rollback = revert the commit; persisted `data.json` shape (settings + syncedHashes) is unchanged. Deploy = rebuild the plugin (`npm run build`) and ship the updated `main.js`.

## Open Questions

None — all six findings have a decided approach above.
