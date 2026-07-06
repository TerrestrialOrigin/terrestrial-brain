## Why

The Obsidian plugin is a single 1,053-line `main.ts` holding the plugin class, sync engine, debouncer, HTTP client, AI-output poller, confirmation modal, settings tab, and utilities all at once. The only seams are the five exported utility functions; everything else is concretely coupled to the Obsidian API, so tests must fabricate fake plugins via `Object.create(prototype)` and overwrite private members, and the plugin's real HTTP code never runs against the real backend anywhere in the repo. `strict` mode is off (only `strictNullChecks`), server responses are cast (`as AIOutputMetadata[]`) rather than validated, and a dead `projectsFolderBase` setting is rendered and persisted but never read. This is fix-plan Step 21 — the leverage step that makes the plugin testable and safe to evolve.

## What Changes

- Split `src/main.ts` into focused modules, each one responsibility: `settings.ts` (settings types, defaults, migration, settings tab), `apiClient.ts` (a `TerrestrialBrainApiClient` interface + `HttpTerrestrialBrainClient` implementation, with `callIngestNote` reduced to a thin wrapper over the shared call — kills the A4 `callHTTP`/`callIngestNote` duplication), `syncEngine.ts` (note processing + debounce + full-vault sync), `aiOutputPoller.ts` (poll + fetch + deliver + reject), `confirmModal.ts` (the confirmation dialog), and `utils.ts` (the pure helpers). `main.ts` becomes a thin composition root that wires these together.
- Extract sync/delivery logic behind narrow **injected ports** — `VaultWriter`, `NoteReader`, `UserNotifier` — following the existing `generateCopyPath(existsCheck)` dependency-injection pattern, so the engine and poller are unit-testable without an Obsidian fake.
- Enable `tsconfig` `"strict": true` and fix the resulting fallout.
- **Validate server responses at the client boundary** with runtime type guards instead of `as AIOutputMetadata[]` / `as AIOutputContent[]` casts — a malformed response is surfaced as an error, not silently trusted.
- **Remove the dead `projectsFolderBase` setting** (declared, rendered, persisted, never read) with a settings migration that drops the stale key on load. **BREAKING** for stored settings shape only (silently migrated; no user action).
- Break up `onload` (~100 lines) and `AIOutputConfirmModal.onOpen` (~95 lines) into named sub-steps.
- Rewrite the vitest suite against the extracted modules (the `Object.create(prototype)` fake-plugin hack largely disappears), and add ONE real integration test in `tests/integration/` that drives the plugin's actual `HttpTerrestrialBrainClient` (imported from plugin source) against the local Supabase stack — closing the Q1 gap where no test anywhere runs the plugin's real HTTP code against the real backend.

## Capabilities

### New Capabilities
- (none — no new user-facing capability; this is a structural refactor of the existing plugin)

### Modified Capabilities
- `obsidian-plugin`: the `projectsFolderBase` setting is removed (and its stale persisted key migrated away on load); server responses to the AI-output poll are validated at the boundary and a malformed response surfaces as an error instead of being cast and trusted. All other behavior (auto-sync, debounce, retry, conflict resolution, key-in-URL migration, HTTPS warning, honest failure reporting) is preserved unchanged.

## Impact

- **Code:** `obsidian-plugin/src/main.ts` split into `main.ts`, `settings.ts`, `apiClient.ts`, `syncEngine.ts`, `aiOutputPoller.ts`, `confirmModal.ts`, `utils.ts`. `obsidian-plugin/tsconfig.json` gains `"strict": true`. `obsidian-plugin/src/main.test.ts` rewritten/split into per-module test files.
- **Tests:** new `tests/integration/plugin_client.test.ts` (Deno) exercising the plugin's real `HttpTerrestrialBrainClient` against the local stack.
- **Specs:** `openspec/specs/obsidian-plugin/spec.md` (settings table loses `projectsFolderBase`; a response-validation requirement is added).
- **No dependencies added.** No server/edge-function behavior change. No migration to `supabase/migrations/`.

## Non-goals

- Config/packaging hygiene (manifest/package version alignment, `versions.json`, pinning `obsidian`, dependency bumps, moving inline styles to `styles.css`) — that is fix-plan **Step 27** (`feature/PluginConfigHygiene`).
- The GDPR deletion pathway (vault-delete → backend erase) — that is fix-plan **Step 25**, which depends on this step's structure.
- Any change to the sync/poll/retry *behavior* itself — the C1/C10/B3/B4/B5 fixes from Step 12 are carried into the new structure verbatim, not re-designed.
