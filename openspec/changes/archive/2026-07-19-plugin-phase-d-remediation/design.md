## Context

The 2026-07-17 scan (`codeEval/Fable20260717RemediationPlan.md`, Phase D) found sixteen findings in `obsidian-plugin/`. The plugin already has a clean seam architecture (ports in `ports.ts`, framework-free `SyncEngine`/`AiOutputPoller`, a `TerrestrialBrainApiClient` interface, pure `settings.ts` migration) — Phase D closes the residual gaps: concurrency races, boundary casts, a passive-only cleartext warning, missing lint/typecheck enforcement, and mutation-check holes in the test suite. All sixteen findings are remediated in this single change (per-step branch protocol collapsed into one change at the user's direction).

Full finding detail (file:line, failure scenarios, fix instructions) lives in the plan's Findings Catalog (PLUG-1..PLUG-16); this design records the decisions, not the catalog.

## Goals / Non-Goals

**Goals:**
- No overlapping `processNote` runs for the same file; no timer or poll survives plugin unload (PLUG-1, PLUG-8).
- All external data entering the plugin (HTTP response envelope, persisted settings, DOM select value, caught unknowns) validated at the boundary — no `as` casts on it (PLUG-2, PLUG-3, PLUG-4, PLUG-14).
- Access key never sent cleartext to a non-local `http://` endpoint (PLUG-6).
- `stripFrontmatter` only strips real frontmatter (PLUG-12).
- ESLint (`no-floating-promises`, `no-explicit-any`) + `noUncheckedIndexedAccess` + test-file typechecking enforced in the build (PLUG-5).
- Mutation-resistant tests for the poller guard, modal resolve/close, `applyPollInterval`, unload cleanup (PLUG-7).
- Duplication removed at the Rule-of-Three sites: sync-active-note entry points, `isRecord`, error-message formatting, numeric-settings rendering (PLUG-9, PLUG-10, PLUG-3, PLUG-15).
- Vault-sync read failures reported as failures; invalid settings input gets visible feedback (PLUG-11, PLUG-15). Test lambdas get real parameter names (PLUG-16).

**Non-Goals:**
- No server-side changes (edge function, SQL, extractors).
- No new plugin features or settings; no change to the ingest/poll endpoint contract.
- Background-poll failures stay silent by design; `simpleHash` width unchanged (accepted items).
- No E2E-in-Obsidian harness — the plugin's test layer remains vitest against the port fakes and the DOM/obsidian stub (established by prior changes; Obsidian itself is not automatable headlessly here).

## Decisions

### D1 — Single-flight per file via an in-flight promise map (PLUG-1)
`SyncEngine` gains `private inFlight = new Map<string, Promise<SyncOutcome>>()`. `processNote` registers its promise under `file.path` before the first await and removes it in `finally`; a second call for the same path returns the existing promise. *Alternative considered:* a boolean set + "skipped" return — rejected because callers (manual sync, vault sync) would misreport an actually-running sync as skipped; returning the shared promise gives every caller the true outcome.
**Runs-twice / crashes-halfway / interleaves:** runs-twice = coalesced by the map; crash-halfway = `finally` clears the entry so the next attempt is clean; interleave = the map is the serialization point (single-threaded event loop makes check-then-set atomic between awaits).

### D2 — Unload discipline via a disposed flag (PLUG-1, PLUG-8)
`clearAllTimers()` sets `private disposed = true`; the scheduler callback and both retry branches bail when disposed, so a failed in-flight sync cannot re-arm a timer after unload. `main.ts` tracks the startup-poll timeout id and clears it in `onunload`. *Alternative:* AbortController through the engine — more invasive than needed; the flag plus scheduler cancellation covers the actual leak paths.

### D3 — Scheduler port instead of global setTimeout (PLUG-13)
`ports.ts` gains `Scheduler { schedule(callback, delayMs): TimerHandle; cancel(handle): void }`, default-wired in `buildCollaborators`. `SyncEngineDeps` takes it; tests use a plain fake scheduler in `testSupport.ts` (no `vi.spyOn(globalThis, "setTimeout")`, no double casts). This also gives D1/D2 tests a deterministic lever to fire timers.

### D4 — Envelope validation in `request()` (PLUG-2)
`response.json()` is wrapped (non-JSON body → `"<label>: server returned non-JSON response"`); the parsed value must pass `isRecord` (else `"Malformed response envelope"`); `result.error` is used only when it is a string. The return type `Record<string, unknown>` becomes honest instead of an implicit cast.

### D5 — Shared `errorMessage(error: unknown)` in utils.ts (PLUG-3)
Replaces the five copies/casts (`(error as Error).message` ×3, inline ternary ×2). This removes the crash-inside-catch path that turned a poll failure into an unhandled rejection.

### D6 — Range-clamp minute settings at the boundary (PLUG-4)
`mergeAndMigrateSettings` accepts a minute value only when `Number.isFinite(value) && value >= 1` (integer-rounded), else the default — applied to both direct fields and the legacy-ms migration results. The UI minimum stays; the boundary no longer trusts it.

### D7 — Hard-refuse cleartext key sends (PLUG-6)
`HttpTerrestrialBrainClient.request()` throws before `fetch` when `isInsecureEndpoint(getEndpointUrl())` is true: `"Refusing to send your access key over unencrypted http://. Use https:// (or a localhost test server)."` The localhost/127.0.0.1 carve-out keeps the dev loop working. The passive settings-tab warning stays as the explanation surface. This upgrades ThreatModel T3 from "Surfaced" to enforced; `ThreatModel.md` is updated in this change. *Alternative:* strip the key but still send — rejected: note content is equally sensitive, and a half-working sync is more confusing than a clear refusal.

### D8 — Anchored frontmatter regex (PLUG-12)
`/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/` — frontmatter must open with `---` as the entire first line and close with `---` on its own line. A leading horizontal rule no longer swallows content (previously a *permanent* truncation, since the hash was computed post-strip).

### D9 — Safety tooling: flat ESLint config, strict tsconfig, test typechecking (PLUG-5)
- `eslint.config.mjs` (flat config) with `typescript-eslint` type-checked rules; `@typescript-eslint/no-floating-promises` and `no-explicit-any` as errors; scoped to `src/**` and `test/**`.
- `tsconfig.json`: add `noUncheckedIndexedAccess: true`; fix fallout with real guards (e.g. `utils.ts` host parsing), not `!`.
- Test files typechecked via a `tsconfig.test.json` extending the main config with tests included; `npm run build` runs `lint` + both typechecks + esbuild. `-skipLibCheck` stays **only** if the `obsidian` package's published typings fail a clean `tsc`; if kept, the build script carries an inline justification comment.
- Where a rule is unfixable at a call site (e.g. an intentionally fire-and-forget promise in an Obsidian event handler), use `void` operator, not eslint-disable.

### D10 — Modal options object + allowlist parse (PLUG-14); vault-sync read honesty (PLUG-11); settings feedback (PLUG-15); dedups (PLUG-9, PLUG-10)
- `AIOutputConfirmModal` constructor becomes `(app, options: { metadataList; conflicts; onResult })`; `select.value === "rename" ? "rename" : "overwrite"` replaces the cast.
- `processNote`'s read-catch returns `"failed"` when `options.force` is set (vault sync / manual — the file list was just enumerated, so a read error is real), keeping `"skipped"` for the debounce path (file may have been deleted mid-delay). The vault-sync summary then reports it as a failure.
- A shared `addMinutesSetting(containerEl, options)` helper renders both numeric settings; invalid input shows a Notice ("Enter a whole number ≥ 1 …") and resets the field text to the stored value.
- `syncActiveNote()` extracted on the plugin; command + ribbon both call it. `isRecord` moves to `utils.ts`; `apiClient.ts`, `settings.ts`, and `extractSyncedHashes` use it.

### D11 — API contract
No backend/API changes — `docs/api-frontend-guide.md` untouched.

### D12 — Test Strategy
- **Unit (vitest, port fakes / obsidian stub):** every finding gets a replicating test written first (bug findings must fail RED against current code): single-flight coalescing and post-unload no-reschedule (fake scheduler); envelope null/string/non-JSON; `errorMessage` shapes; settings clamp (0 / negative / NaN / legacy-ms); insecure-endpoint refusal (fetch never called; localhost allowed); frontmatter hr-vs-real cases; poller re-entrancy; modal resolve/close/Escape-postpone/`onResult`-once; `applyPollInterval` dedup + re-register; `onunload` clears interval, startup timeout, and engine timers; vault-sync read failure counted as failed; `isRecord`; settings-tab invalid-input feedback.
- **Mutation checks (GATE 2b):** deleting the in-flight guard, the disposed bail-out, the clamp, the insecure refusal, the poller guard, the modal `resolve` body, and the `applyPollInterval` no-op must each redden at least one test.
- **Integration:** the existing Deno integration test exercising `HttpTerrestrialBrainClient` against the live stack stays green (mock-boundary rule: unit tests fake `fetch`/ports; the integration path has no mocks).
- **No new E2E layer** (see Non-Goals); full repo gates (`deno task test` on a reset stack, plugin `npm test` + `npm run build`, `npm run validate`) run before done.

### D13 — User error scenarios
| Mistake | Handling |
|---|---|
| Typo `http://` for `https://` on a remote endpoint | Request refused before send with an explanatory Notice (D7); settings warning explains |
| Hand-edits `data.json` to `pollIntervalMinutes: 0` / `-5` / `NaN` | Clamped to defaults at load (D6) — no 0 ms poll hammering |
| Types `0`, `-3`, or `abc` into a minutes field | Notice + field resets to stored value (D10) — no silent ignore |
| Double-clicks ribbon "Sync note" / runs manual sync during a debounce-fired sync | Coalesced into one ingest (D1) |
| Disables the plugin mid-sync or within the 2 s startup window | No timer, retry, or poll fires afterwards (D2) |
| Presses Escape on the AI-output modal | Treated as postpone — pending outputs are never destroyed by a dismissal (guarded by new tests) |
| Points the plugin at a server returning HTML (captive portal/proxy) | Friendly "non-JSON response" error, not a raw SyntaxError (D4) |

### D14 — Security analysis
Threats considered for this change (STRIDE-lite), recorded in `ThreatModel.md`:
- **Information disclosure — cleartext key+content over `http://` (T3):** upgraded from surfaced-warning to hard refusal (D7). Residual: localhost traffic is cleartext by design (local stack).
- **Information disclosure — credentialed requests from a dead plugin:** post-unload timers/polls could fire authenticated requests after the user believed the plugin off (PLUG-1/8); eliminated by D2. Recorded as a note under T4's plugin-surface context.
- **Tampering — malformed server responses:** a compromised/misconfigured endpoint returning non-record envelopes now yields a typed error instead of undefined-property flow (D4); AI-output payload validation (existing boundary guards) unchanged.
- **DoS (self-inflicted) — 0 ms poll loop hammering the authenticated endpoint from a corrupted settings file:** eliminated by D6.
No new attack surface is added: no new endpoints, no new secrets, no new storage.

## Risks / Trade-offs

- [Hard `http://` refusal breaks a legitimate LAN self-hoster] → The Notice names the exact remedy (https or localhost); the settings warning already flagged this config. Accepted: shipping the key cleartext is worse than a broken sync.
- [`noUncheckedIndexedAccess` + new ESLint surface a pile of pre-existing type fallout] → Fix with real guards; budget for mechanical churn across `src/` and tests. If `obsidian` typings force `skipLibCheck`, keep it with an inline justification (D9).
- [Coalescing returns the *in-flight* run's outcome to the second caller] → For a force-sync issued during a debounce-fired sync of the same content this is correct (same content, one ingest). A user who edits and instantly force-syncs may get the pre-edit run's result; the debounce timer for the new edit still covers the delta. Accepted.
- [Read-failure → "failed" in vault sync changes summary semantics] → Intended (that's PLUG-11); the debounce path keeps its lenient "skipped".
- [One big change touches every plugin file] → Findings are small and mostly independent; the full plugin suite + repo gates run once at the end, and tests are written finding-first (RED) so regressions localize.

## Migration Plan

Plugin-internal only: no data migration, no settings-shape change (clamping happens on load; a re-persist normalizes values). Rollback = revert the merge commit. New dev dependencies (`eslint`, `typescript-eslint`) are build-time only and do not affect the bundled `main.js` runtime.

## Open Questions

None — all sixteen findings carry explicit fix instructions in the plan; deviations above (D1 promise-map vs boolean, D7 hard-refuse) are decided here.
