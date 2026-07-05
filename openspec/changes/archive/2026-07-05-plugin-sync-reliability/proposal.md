## Why

The Obsidian plugin has several sync-reliability defects that make it silently lose work or misreport success (fix-plan Step 12, eval findings C1, C10, B3, B4, B5, plugin S4). "Vault sync complete" is shown even when every note failed; the AI-output poll timer is starved by unrelated saves; a file deleted or renamed during the 5-minute debounce window causes an unhandled rejection; failed manual pulls are silent; a failed scheduled sync is dropped forever; and raw server response bodies (potentially stack traces) are shown verbatim in user notices.

## What Changes

- **C1 — Honest vault-sync reporting.** `processNote` reports its outcome (`"synced" | "skipped" | "failed"`) instead of swallowing errors; the entire-vault sync command counts real failures from that return value, so a total failure shows a failure notice instead of "✅ Vault sync complete".
- **C10 — Stop starving the poll timer.** Split settings persistence from side effects: `saveSettings` only writes to disk; the poll interval is (re)started only when `pollIntervalMinutes` actually changed, not on every sync/delivery/keystroke. Prevents stale interval accumulation and a poll that rarely fires.
- **B3 — Robust debounce lifecycle.** Wrap the debounce timer body (including `vault.read`) in try/catch so a file deleted mid-delay cannot raise an unhandled rejection; cancel pending timers and drop the hash on vault `delete`; on `rename`, cancel the old timer and re-key the stored hash to the new path.
- **B4 — Surface manual pull failures.** A failed manual "Pull AI Output" shows a Notice, not only a `console.error`.
- **B5 — Minimal retry for scheduled syncs.** A failed scheduled (debounced) sync re-schedules itself with capped exponential backoff instead of silently dropping; behavior documented in the settings description.
- **Plugin S4 — Sanitize error notices.** Server response bodies embedded in error Notices are truncated to a bounded length (raw bodies / stack traces are no longer shown in full to the user). `console.error` keeps the full detail for debugging.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `obsidian-plugin`: `openspec/specs/obsidian-plugin/spec.md` — modifies the "Manual sync — entire vault", "Auto-sync on edit", "AI output polling", "Manual AI output poll", and "Plugin lifecycle" requirements, and adds requirements for the vault delete/rename lifecycle, scheduled-sync retry, and error-notice sanitization.

## Non-goals

- The full plugin modularization (splitting `main.ts` into modules) is out of scope — that is fix-plan Step 21. This change fixes the reliability bugs in place.
- A general offline queue / persistent retry across restarts is out of scope; B5 is an in-memory capped-backoff re-schedule only.
- No server-side (Deno / edge function) changes; this change is plugin-only (`obsidian-plugin/`).

## Impact

- Code: `obsidian-plugin/src/main.ts` (`processNote`, the vault-sync command, `saveSettings`, `startPollInterval`, `scheduleSync`, `onload` event registration, `pollAIOutput`, `callHTTP`, `callIngestNote`), `obsidian-plugin/src/main.test.ts`.
- Spec: `openspec/specs/obsidian-plugin/spec.md`.
- No API, database, or dependency changes. No breaking changes to persisted settings.
