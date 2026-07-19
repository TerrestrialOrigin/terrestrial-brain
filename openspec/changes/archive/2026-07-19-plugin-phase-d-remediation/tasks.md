## 1. Scheduler seam & sync concurrency (PLUG-13, PLUG-1, PLUG-8 — Step 21)

- [x] 1.1 Add `Scheduler` port to `ports.ts` (`schedule(callback, delayMs): TimerHandle; cancel(handle): void`); wire the real implementation in `main.ts` `buildCollaborators`; add it to `SyncEngineDeps`; replace direct `setTimeout`/`clearTimeout` in `syncEngine.ts`; replace `captureTimers()` global spy in `testSupport.ts` with a plain fake scheduler and migrate existing syncEngine tests to it
- [x] 1.2 Write RED tests: (a) concurrent `processNote` for the same path sends one ingest, both callers get the outcome; (b) failing in-flight sync after `clearAllTimers()` schedules no new timer; confirm both fail against current code
- [x] 1.3 Implement the in-flight promise map (register before first await, clear in `finally`) and the `disposed` flag (set in `clearAllTimers`, bail in timer callback and both retry branches); tests green
- [x] 1.4 Write RED test: unload within the startup-poll window fires no poll; then track the startup `setTimeout` id in `main.ts` and clear it in `onunload`; test green

## 2. Boundary validation (PLUG-3, PLUG-2, PLUG-4, PLUG-6, PLUG-12 — Step 22)

- [x] 2.1 Add `errorMessage(error: unknown)` to `utils.ts` with unit tests (`Error`, string, plain object); replace all five formatting sites (`aiOutputPoller.ts` ×2, `syncEngine.ts` ×3); add RED-first poller test: manual pull rejecting with a string shows a Notice instead of throwing
- [x] 2.2 RED tests for `request()` envelope: `json()` → `null`, `"oops"`, and a throwing `json` each reject with friendly messages; implement try/catch around `response.json()` + `isRecord` envelope check + string-only `result.error`
- [x] 2.3 RED tests for settings clamp (`syncDelayMinutes: 0`, `pollIntervalMinutes: -5`, `NaN`, plus legacy-ms migration producing < 1) → defaults; implement the finite-and-`>= 1` clamp in `mergeAndMigrateSettings`
- [x] 2.4 RED tests for cleartext refusal: request to `http://example.com/mcp` rejects and `fetch` is never called; `http://localhost:54321/...` still works; implement the `isInsecureEndpoint` check-and-throw at the top of `request()`
- [x] 2.5 RED tests for `stripFrontmatter`: leading-horizontal-rule note unchanged; real frontmatter stripped; frontmatter containing `---` inside a value; implement the anchored regex

## 3. Cleanup & dedup (PLUG-9, PLUG-10, PLUG-11, PLUG-14, PLUG-15 — Step 24 items that PLUG-7 tests build on)

- [x] 3.1 Move `isRecord` to `utils.ts` with a direct unit test; delete the copies in `apiClient.ts` and `settings.ts`; rewrite `extractSyncedHashes` in `main.ts` to use it
- [x] 3.2 Extract `syncActiveNote()` on the plugin; command palette and ribbon item both call it
- [x] 3.3 RED test: vault sync over one readable + one throwing reader → `{ synced: 1, failed: 1, skipped: 0 }` and the failure notice; implement read-catch returning `"failed"` when `options.force` is set
- [x] 3.4 Change `AIOutputConfirmModal` constructor to `(app, options: { metadataList; conflicts; onResult })`; replace the `select.value` cast with the allowlist parse; update both call sites
- [x] 3.5 Extract shared `addMinutesSetting` helper in `settings.ts`; on invalid input show a Notice ("Enter a whole number ≥ 1") and reset the field to the stored value; cover with a settings-tab test (extend `TextStub` to retain the `onChange` callback and expose the rendered value)

## 4. Mutation-resistant tests (PLUG-7 — Step 23)

- [x] 4.1 Poller re-entrancy test: `metadataImpl` gated on a deferred, `pollAIOutput()` called twice before resolve → one fetch; verify deleting the `pollInProgress` guard reddens it
- [x] 4.2 ConfirmModal behavior tests: extend the element stub's `addEventListener` to record listeners; assert the three button decisions via `getResult()`; `onClose()` without a choice → `{ decision: "postponed" }`; button then `onClose()` → `onResult` fired exactly once; verify deleting the `resolve` body reddens them
- [x] 4.3 main.test.ts: `applyPollInterval()` twice with same minutes → one `setInterval`; changed minutes → `clearInterval` old id + new `setInterval`; `onunload()` → interval cleared, startup timeout cleared, `clearAllTimers` called

## 5. Safety tooling (PLUG-5, PLUG-16 — Step 23)

- [x] 5.1 Add `noUncheckedIndexedAccess: true` to `tsconfig.json` and fix all fallout with real guards (e.g. `utils.ts` host split); add `tsconfig.test.json` covering test files and wire a typecheck of it into the build script; drop `-skipLibCheck` if the `obsidian` typings pass clean, else keep with an inline justification
- [x] 5.2 Add `eslint` + `typescript-eslint` (flat `eslint.config.mjs`) with `no-floating-promises` and `no-explicit-any` as errors over `src/**` and `test/**`; add `lint` script; wire lint into `npm run build`; fix all violations (including the unused `beforeEach` import and the `any`s in `test/obsidian-stub.ts`) using `void`/real types, never `eslint-disable`
- [x] 5.3 Rename all single-letter lambda parameters in test files (`syncEngine.test.ts`, `aiOutputPoller.test.ts`, `main.test.ts`) to descriptive names

## 6. Documentation & threat model

- [x] 6.1 Update `ThreatModel.md` T3 row: cleartext sends now refused by the client (warning retained); note the post-unload credentialed-request leak closed under the plugin surface context
- [x] 6.2 Mark Phase D (Steps 21–24) complete in `codeEval/Fable20260717RemediationPlan.md`

## 7. Testing & Verification

- [x] 7.1 GATE 2b sweep: confirm each key guard (in-flight map, disposed bail, clamp, cleartext refusal, poller guard, modal resolve, applyPollInterval no-op, frontmatter anchor) reddens at least one test when reverted
- [x] 7.2 Plugin suite green: `cd obsidian-plugin && npm test` — 0 failed, 0 skipped; `npm run build` (lint + typechecks + bundle) green
- [x] 7.3 Backend suite green on a fresh stack: `npx supabase db reset`, warm the function, `deno task test` — 0 failed, 0 skipped (tree kept stable during the run)
- [x] 7.4 `npm run validate` / `scripts/validate-all.sh` green (verify it already covers the new lint gate via `npm run build`; update if not)
- [x] 7.5 Walk each delta-spec scenario and confirm the implementation + a test covers it
