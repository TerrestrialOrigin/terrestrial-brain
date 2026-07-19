## Why

The 2026-07-17 code-quality scan (`codeEval/Fable20260717RemediationPlan.md`, Phase D, Steps 21–24) found sixteen defects in the Obsidian plugin (PLUG-1..PLUG-16): sync re-entrancy races that double-ingest notes and let timers fire after unload, unvalidated external data at the HTTP/settings/DOM boundaries, the access key sent in cleartext over `http://`, an over-greedy frontmatter regex that permanently truncates notes, missing safety tooling (no ESLint, `noUncheckedIndexedAccess` off, test files never typechecked), and several mutation-check gaps where deleting core guards fails no test. These are the last Medium-severity correctness findings before the Phase E style sweep.

## What Changes

- **Sync concurrency (Step 21 — PLUG-1, PLUG-8, PLUG-13):** `SyncEngine` gains an in-flight map so overlapping `processNote` calls for the same file coalesce instead of double-ingesting; an `unloaded` flag stops failed in-flight syncs from resurrecting retry timers after `clearAllTimers()`; timers move behind an injectable `Scheduler` port (no more global `setTimeout` monkey-patching in tests); the 2 s startup-poll timeout is tracked and cleared on unload.
- **Boundary validation (Step 22 — PLUG-2, PLUG-3, PLUG-4, PLUG-6, PLUG-12):** the API client validates the JSON response envelope (non-JSON, null, or non-record bodies become friendly errors, not TypeErrors); a shared `errorMessage(error: unknown)` helper replaces five `(error as Error).message` casts/copies; minute settings loaded from disk are range-clamped (`>= 1`, finite) so a corrupted `data.json` cannot produce a 0 ms poll loop; requests to non-local `http://` endpoints are refused before `fetch` so the access key and note content never travel cleartext; `stripFrontmatter` is tightened so a note opening with a horizontal rule is no longer truncated.
- **Safety tooling (Step 23 — PLUG-5, PLUG-7):** ESLint (typescript-eslint with `no-floating-promises` and `no-explicit-any` as errors) is added and wired into the build; `noUncheckedIndexedAccess` is turned on; test files get typechecked; mutation-resistant tests are added for the poller re-entrancy guard, the confirm modal's resolve/close logic, `applyPollInterval` dedup, and unload cleanup.
- **Cleanup (Step 24 — PLUG-9, PLUG-10, PLUG-11, PLUG-14, PLUG-15, PLUG-16):** "sync active note" is extracted once and shared by the command palette and ribbon entry points; `isRecord` is deduplicated into `utils.ts`; a read failure during a forced vault sync counts as `failed`, not `skipped`; `AIOutputConfirmModal` takes an options object and parses `select.value` via allowlist; invalid numeric settings input shows feedback and resets the field; single-letter lambda parameters in test files are renamed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `obsidian-plugin` (`openspec/specs/obsidian-plugin/spec.md`): new requirements for single-flight sync per file, unload discipline (no timers/polls survive unload), response-envelope validation, settings range clamping, refusal to send credentials over cleartext non-local `http://`, precise frontmatter stripping, vault-sync read-failure honesty, and settings-input feedback.
- `developer-workflow` (`openspec/specs/developer-workflow/spec.md`): the plugin build gains an ESLint gate (`no-floating-promises`, `no-explicit-any`), `noUncheckedIndexedAccess`, and typechecking of test files.

## Non-goals

- No changes to the Supabase edge function, repositories, extractors, or SQL (Phases A–C already landed; Phase E covers server-side structure).
- No new plugin features — every change is a correctness, security, or tooling remediation of existing behavior.
- Background-poll failures staying silent (by design, aiOutputPoller.ts) and `simpleHash`'s 32-bit collision window remain as-is (explicit Deliberate No-Action items in the scan).
- No changes to the sync data model, endpoint contract, or settings schema shape (only value clamping and UI feedback).

## Impact

- **Code:** `obsidian-plugin/src/` (syncEngine, aiOutputPoller, apiClient, settings, utils, main, confirmModal, ports, testSupport), `obsidian-plugin/test/obsidian-stub.ts`, all plugin `*.test.ts` files.
- **Config/deps:** `obsidian-plugin/tsconfig.json` (+`noUncheckedIndexedAccess`, test typecheck), `obsidian-plugin/package.json` (+eslint, typescript-eslint, lint script wired into build), new `eslint.config.mjs`.
- **CI/validate:** `scripts/validate-all.sh` and CI already run `npm test && npm run build` in `obsidian-plugin/`; the lint gate rides along inside `npm run build`.
- **Behavior changes visible to users:** cleartext `http://` (non-local) syncs now fail with an explanatory Notice instead of silently leaking the key; invalid settings input now gets feedback; vault-sync summaries report read failures as failures.
