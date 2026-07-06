# Tasks — plugin-modularization

Refactor discipline: after each extraction group, `npm run build` and the full vitest suite must be green. Behavior is preserved; a test that *needs* to change is a signal to investigate, not to rewrite.

## 1. Extract pure utilities

- [x] 1.1 Create `src/utils.ts` and move the eight pure helpers verbatim: `formatFileSize`, `stripFrontmatter`, `truncateForNotice`, `simpleHash`, `buildEndpointUrl`, `extractKeyFromUrl`, `isInsecureEndpoint`, `generateCopyPath`. Fix the orphaned/misplaced JSDoc above `buildEndpointUrl` while moving it.
- [x] 1.2 Re-export the utilities from `main.ts` (temporary) so existing imports keep working; build green.
- [x] 1.3 Create `src/utils.test.ts` and move the pure-utility tests (`formatFileSize`, `stripFrontmatter`, `simpleHash`, `truncateForNotice`, `generateCopyPath`, `buildEndpointUrl`, `extractKeyFromUrl`, `isInsecureEndpoint`) out of `main.test.ts`. Vitest green.

## 2. API client abstraction (kills A4 duplication, adds boundary validation)

- [x] 2.1 Create `src/apiClient.ts`: define the `TerrestrialBrainApiClient` interface (`call(endpointName, body?)`, `ingestNote(content, title, noteId)`) and `HttpTerrestrialBrainClient` implementing both against `fetch`, constructed from `{ getEndpointUrl(): string; getAccessKey(): string }` accessors. One shared private request-builder handles headers (`x-brain-key`), `buildEndpointUrl`, `response.ok` + `truncateForNotice`. `ingestNote` is a thin wrapper over the shared path (no duplicated HTTP code).
- [x] 2.2 Add response type-guards `isAIOutputMetadataArray(value): value is AIOutputMetadata[]` and `isAIOutputContentArray(value): value is AIOutputContent[]` in `apiClient.ts`; export `AIOutputMetadata`/`AIOutputContent` types from here.
- [x] 2.3 Create `src/apiClient.test.ts` running the REAL `HttpTerrestrialBrainClient` with `fetch` mocked at the boundary: header presence/omission, key-not-in-URL, HTTP-error truncation, success/failure parsing, and the note-ingest path. Add malformed-response guard tests (GATE 2b: deleting a guard must redden a test).

## 3. Settings module + migration

- [x] 3.1 Create `src/settings.ts`: `TBPluginSettings` type (WITHOUT `projectsFolderBase`), `DEFAULT_SETTINGS`, a pure `mergeAndMigrateSettings(rawData): { settings, changed }` (ms→minutes migration, exclude-tag normalization, drop obsolete keys incl. `projectsFolderBase`), and the `TBSettingTab` UI (no projects-folder row).
- [x] 3.2 Remove `projectsFolderBase` from every declaration/render/persist site.
- [x] 3.3 Create `src/settings.test.ts`: move the migration tests; add the `projectsFolderBase` drop + persist-once and no-persist-when-clean scenarios.

## 4. Confirmation modal module

- [x] 4.1 Create `src/confirmModal.ts`: move `AIOutputConfirmModal`; break `onOpen` (~95 lines) into named sub-render helpers (`renderHeader`, `renderList`/`renderItem`, `renderButtons`). Depends only on `utils` + shared types.

## 5. Sync engine + ports

- [x] 5.1 Define ports in a small module (`src/ports.ts` or top of `syncEngine.ts`): `NoteReader`, `VaultWriter`, `UserNotifier`, `FileClassifier` (`isExcluded`). Keep each 1–3 methods.
- [x] 5.2 Create `src/syncEngine.ts`: `SyncEngine` class owning `processNote`, `scheduleSync`/debounce + retry/backoff, `syncEntireVault`, `handleFileDelete`/`handleFileRename`, using the API client + ports — no direct Obsidian `App` reference. Preserve C1/B3/B5 behavior exactly.
- [x] 5.3 Create `src/syncEngine.test.ts`: re-point the C1 honest-failure, B3 delete/rename, B5 retry-backoff, processNote-outcome, and exclusion tests at `SyncEngine` with fake ports (drop `Object.create(prototype)`).

## 6. AI-output poller + ports

- [x] 6.1 Create `src/aiOutputPoller.ts`: `AiOutputPoller` class owning `pollAIOutput`, fetch+deliver, reject — using the API client (with boundary guards), ports, and a `ConflictPrompt` port that wraps opening the modal. Preserve C10-adjacent poll-in-progress guard, B4 manual-pull Notice, conflict overwrite/rename, hash storage.
- [x] 6.2 Create `src/aiOutputPoller.test.ts`: re-point the two-phase-fetch, conflict-detection, conflict-aware-writing, empty-poll-notice, and B4 tests at `AiOutputPoller` with fake ports; add the malformed-response-surfacing test.

## 7. Composition root

- [x] 7.1 Rewrite `src/main.ts` as a thin `TerrestrialBrainPlugin`: `onload` constructs Obsidian-backed adapters (NoteReader/VaultWriter/UserNotifier/ConflictPrompt/FileClassifier + HttpTerrestrialBrainClient), instantiates `SyncEngine` + `AiOutputPoller`, wires vault events/commands/ribbon/settings-tab, and manages `applyPollInterval` (C10). Break `onload` into named sub-steps (`registerVaultEvents`, `registerCommands`, `registerRibbon`, `startPolling`). Keep `saveSettings`/`persistData` separation (C10).
- [x] 7.2 Ensure `main.ts` re-exports whatever the integration test / public surface needs; remove temporary util re-exports once callers import from `utils.ts`.

## 8. Strict mode

- [x] 8.1 Set `"strict": true` in `obsidian-plugin/tsconfig.json`; remove now-redundant `strictNullChecks`.
- [x] 8.2 Fix all fallout WITHOUT `any`/`!` on external data (type migration `raw` as `Record<string, unknown>`; initialize `settings`/`syncedHashes`; narrow DOM callbacks). `npm run build` green.

## 9. Plugin-client integration test (Q1)

- [x] 9.1 Add `tests/integration/plugin_client.test.ts` (Deno): import the plugin's real `HttpTerrestrialBrainClient` from source and drive it against the local Supabase stack — a real `ingestNote` round-trip and a real `call("get-pending-ai-output-metadata")`, zero mocks on the tested path. Fail loudly (no skip) if the stack/key is absent. Clean up any fixtures in `try/finally`.

## 10. Testing & Verification

- [x] 10.1 `cd obsidian-plugin && npm run build` — green (tsc strict + esbuild).
- [x] 10.2 `cd obsidian-plugin && npm test` — full vitest green, 0 skips, 0 failures; confirm `Object.create(prototype)` fake-plugin hack is gone from the rewritten suites.
- [x] 10.3 With the local Supabase stack up: `deno test --allow-net --allow-env tests/` — green including the new `plugin_client.test.ts`.
- [x] 10.4 GATE 2b spot-check: deleting a boundary guard reddens an apiClient/poller test; deleting the honest-failure count reddens a syncEngine test.
- [x] 10.5 Update the base spec settings table (drop the `projectsFolderBase` row) at archive time; run `/opsx:verify`.
- [x] 10.6 Mark fix-plan Step 21 complete in `codeEval/Fable20260704-fix-plan.md`.
