## Context

`obsidian-plugin/src/main.ts` is a 1,053-line monolith: the `TerrestrialBrainPlugin` class, the debounced sync engine, the raw HTTP client (`callHTTP` + a near-duplicate `callIngestNote`), the AI-output poller, the `AIOutputConfirmModal`, the `TBSettingTab`, and eight pure utility functions all live in one file. Only the five exported utilities have seams; everything else is welded to the Obsidian API. Consequences the eval flagged:

- Tests fabricate a plugin with `Object.create(TerrestrialBrainPlugin.prototype)` and overwrite private members (`main.test.ts:68-130`) — brittle, and it let bug C10 hide because `saveSettings` was mocked.
- The plugin's real `callHTTP`/`callIngestNote` never run against the real backend anywhere in the repo — a server response-shape change breaks the plugin while every test stays green (Q1).
- `strict` is off (only `strictNullChecks`), server responses are cast (`as AIOutputMetadata[]`, lines 328/380), and `projectsFolderBase` is a dead setting.

Step 12 (`plugin-sync-reliability`) already fixed the correctness bugs (C1 honest failure reporting, C10 poll-timer starvation, B3 delete/rename lifecycle, B4 manual-pull notice, B5 retry). Those fixes are **preserved verbatim** — this step only moves code and adds seams.

## Goals / Non-Goals

**Goals:**
- Decompose `main.ts` into six single-responsibility modules plus a thin composition-root `main.ts`.
- Introduce a `TerrestrialBrainApiClient` interface and an `HttpTerrestrialBrainClient` implementation; make the sync engine and poller depend on narrow injected ports (`VaultWriter`, `NoteReader`, `UserNotifier`, `ConflictPrompt`) so they are unit-testable without an Obsidian fake.
- Enable `tsconfig` `"strict": true` and fix the fallout.
- Validate poll responses at the client boundary with runtime guards; a malformed response is an error, not a silent cast.
- Remove the dead `projectsFolderBase` setting with a migration.
- Add one real plugin-client → local-stack integration test (Q1).

**Non-Goals:**
- Packaging/config hygiene (Step 27), GDPR deletion pathway (Step 25), and any redesign of sync/poll *behavior* (Step 12 owns that).
- Changing the wire protocol or the edge function. No new npm dependency.

## Decisions

### D1 — Module layout

```
src/
  main.ts            Composition root: TerrestrialBrainPlugin. onload() wires ports → engine/poller,
                     registers events/commands/ribbon/settings-tab. No business logic beyond wiring.
  settings.ts        TBPluginSettings type, DEFAULT_SETTINGS, loadSettings/migrate logic (pure,
                     given raw data), and TBSettingTab (the settings UI).
  apiClient.ts       TerrestrialBrainApiClient interface + HttpTerrestrialBrainClient impl.
                     Response type-guards (isAIOutputMetadataArray, isAIOutputContentArray) live here.
  syncEngine.ts      SyncEngine class: processNote, scheduleSync/debounce, syncEntireVault,
                     handleFileDelete/Rename. Depends on ports, not on Plugin.
  aiOutputPoller.ts  AiOutputPoller class: pollAIOutput, fetch+deliver, reject. Depends on ports.
  confirmModal.ts    AIOutputConfirmModal (Obsidian Modal subclass) + its onOpen sub-render helpers.
  utils.ts           formatFileSize, stripFrontmatter, truncateForNotice, simpleHash,
                     buildEndpointUrl, extractKeyFromUrl, isInsecureEndpoint, generateCopyPath.
```

**Rationale:** matches the six-module split named in the fix-plan and the eval's "should be ~6 modules with `main.ts` as a thin composition root." Each module maps to one of the responsibilities the eval listed (client / sync / poll / modal / settings / utils).

**Alternative considered:** a single `plugin.ts` keeping the class but importing helpers. Rejected — it leaves the god-class intact and doesn't create the port seams that make the logic testable, which is the whole point of the step.

### D2 — Ports (dependency-injection seams)

Define narrow interfaces the engine/poller depend on, so no test needs an Obsidian fake:

- `NoteReader` — `read(file): Promise<string>`, `exists(path): Promise<boolean>` (wraps `vault.read` / `adapter.exists`).
- `VaultWriter` — `write(path, content)`, `mkdir(folder)` (wraps `vault.adapter`).
- `UserNotifier` — `notify(message, timeoutMs?)` (wraps `new Notice(...)`), so tests assert on captured messages instead of a global Notice spy.
- `ConflictPrompt` — `confirm(metadataList, conflicts): Promise<ConfirmationResult>` (wraps opening the modal), so the poller is tested without the DOM.
- `MetadataProvider` — `isExcluded(file): boolean` stays with the engine; the exclude-tag check reads `metadataCache`, so the engine takes a small `FileClassifier` port exposing `isExcluded`.

The concrete Obsidian-backed adapters are constructed once in `main.ts.onload()` (the composition root) — this is exactly the `generateCopyPath(existsCheck)` pattern generalized. Ports are 1–3 methods each (owner rule: narrow injectable interfaces).

**Alternative considered:** pass the whole `App` object down. Rejected — that re-couples the engine to Obsidian and defeats the seam.

### D3 — `TerrestrialBrainApiClient` interface kills the A4 duplication

```ts
interface TerrestrialBrainApiClient {
  call(endpointName: string, body?: Record<string, unknown>): Promise<Record<string, unknown>>;
  ingestNote(content: string, title: string, noteId: string): Promise<string>;
}
```

`HttpTerrestrialBrainClient` implements both against `fetch`, sharing one private request-builder (headers with `x-brain-key`, `buildEndpointUrl`, `response.ok` + `truncateForNotice` handling). `ingestNote` becomes a thin wrapper that calls the shared request path and returns `result.message` — removing the ~40 duplicated lines the eval flagged (A4, `main.ts:406-448` in the pre-Step-12 numbering). The client is constructed from `{ getEndpointUrl(): string; getAccessKey(): string }` accessors so it always reads current settings.

### D4 — Boundary validation replaces casts

`apiClient.ts` exports runtime guards and the client's `pollMetadata()` / `fetchContent(ids)` helpers return validated arrays:

```ts
function isAIOutputMetadataArray(value: unknown): value is AIOutputMetadata[]
function isAIOutputContentArray(value: unknown): value is AIOutputContent[]
```

The poller calls these; a response whose `data` fails the guard throws `Error("Malformed AI-output response from server")` (surfaced to the user on a manual pull, logged on a background poll) rather than being cast with `as`. This satisfies the owner's "parse, don't cast" rule for external data without adding a Zod dependency to the plugin bundle (hand guards are enough for two flat shapes and keep the esbuild output small).

**Alternative considered:** add `zod` to the plugin. Rejected for now — two flat interfaces don't justify a new bundled dependency; guards are sufficient and dependency-free. (If plugin-side validation grows, revisit.)

### D5 — `projectsFolderBase` removal + migration

Drop the field from `TBPluginSettings`, `DEFAULT_SETTINGS`, and the settings tab. `loadSettings` already builds `settings` via `Object.assign({}, DEFAULT_SETTINGS, raw)`; add an explicit `delete (settings as Record<string, unknown>).projectsFolderBase` alongside the existing `debounceMs`/`pollIntervalMs` cleanup, and persist once if the stale key was present (reusing the existing "persist on migration" path). No data loss — the field was never read.

### D6 — `strict: true`

Turn on full `strict`. Expected fallout: implicit-`any` in the settings-migration `raw` handling and the modal's DOM callbacks, and `strictPropertyInitialization` on the plugin's `settings` field (initialize in `onload` or mark with a definite-assignment assertion consistent with Obsidian's plugin lifecycle). Fix by typing `raw` as `Record<string, unknown>` and narrowing, not by re-adding `any`.

### Test Strategy

Per the owner's testing gates, this refactor's safety net is behavior-preservation:

- **Unit (vitest, `obsidian-plugin/src/*.test.ts`):** one test file per extracted module. The pure utils tests carry over unchanged. `syncEngine.test.ts` and `aiOutputPoller.test.ts` now construct the real classes with **fake ports** (fakes, not Obsidian mocks) — no `Object.create(prototype)`. Every existing behavioral assertion (C1 honest failure, C10 no-restart-on-save, B3 delete/rename, B4 manual-pull notice, B5 retry backoff, conflict overwrite/rename, hash storage, exclude logic, key migration, HTTPS warning) is preserved, re-pointed at the new classes. `apiClient.test.ts` runs the **real** `HttpTerrestrialBrainClient` with `fetch` mocked at the boundary, including the new malformed-response guard tests.
- **Integration (Deno, `tests/integration/plugin_client.test.ts`):** imports the plugin's real `HttpTerrestrialBrainClient` from source and drives it against the local Supabase stack — a real `ingestNote` and a real `call("get-pending-ai-output-metadata")` round-trip, zero mocks on the tested path (closes Q1). This is the mock-boundary-compliant integration test the owner's GATE 2 requires.
- **GATE 2b mutation check:** the malformed-response guard and the honest-failure counting must each fail if their implementation line is deleted — verified by writing those assertions to exercise real code.
- **Build gate:** `npm run build` (`tsc -noEmit` under `strict` + esbuild) must be green.

## Risks / Trade-offs

- **[Behavior drift during the move]** → The existing vitest suite is comprehensive; port every assertion and keep the suite green at each extraction. Any test that *needs* to change is a red flag to investigate, not to rewrite.
- **[`strict: true` surfaces latent bugs mid-refactor]** → Good — fix them properly (type `raw`, initialize fields); never silence with `any`/`!` on external data.
- **[The Deno integration test needs a running stack + a valid key]** → It reads `SUPABASE_URL`/key from the same env the rest of `tests/integration/` uses; document the stack requirement in test-plan. It must fail loudly (not skip) if the stack is absent, per the zero-skips rule.
- **[Import cycles between modules]** → Keep the dependency graph acyclic: `utils` depends on nothing; `apiClient` on `utils`; `settings` on `utils`; `syncEngine`/`aiOutputPoller` on `apiClient` + `utils` + ports; `main` on all. Modal depends only on `utils`.

## Migration Plan

1. Land the extraction on the feature branch; `npm run build` + full vitest green after each module is pulled out.
2. Settings migration is automatic on next plugin load (stale `projectsFolderBase` dropped); no user action, no backend change, no DB migration.
3. Rollback: revert the branch — the wire protocol and persisted-settings *values* (minus the ignored dead field) are unchanged, so a downgrade re-reads the same `data.json` without loss.

## User Error Scenarios

- **User pastes an endpoint URL still containing `?key=`** → handled as today: `extractKeyFromUrl` moves the key into `accessKey` and strips the URL (carried into `settings.ts`).
- **User configures a plain `http://` non-local endpoint** → the HTTPS warning (`isInsecureEndpoint`) still renders in the settings tab.
- **Server returns a malformed / non-array poll payload** → NEW: the boundary guard throws a bounded, sanitized error (manual pull shows a Notice; background poll logs) instead of casting and crashing later on `.map`.
- **User sets sync delay / poll interval to a non-number or < 1** → unchanged: the settings `onChange` rejects it (parseInt guard).
- **File deleted/renamed during the debounce window** → unchanged (B3): timer cancelled, hash re-keyed, read errors return `"skipped"`.

## Security Analysis

Threats are unchanged from the current plugin (this is a move + seam refactor); documented in `ThreatModel.md`:
- **Key exposure** — the access key stays in the `x-brain-key` header (never the URL); `HttpTerrestrialBrainClient` centralizes this so it can't regress per-call. Error notices remain bounded/sanitized via `truncateForNotice` so a server stack trace isn't shown verbatim.
- **Cleartext transport** — the `isInsecureEndpoint` warning is preserved.
- **Untrusted server response** — NEW mitigation: boundary validation of poll responses before they drive file writes, so a compromised/buggy endpoint can't feed unexpected shapes into vault-write logic.
- No new attack surface: no new dependency, no new endpoint, no new persisted secret.

## Open Questions

- None blocking. `MetadataProvider`/`FileClassifier` port granularity may be tuned during implementation as long as the engine stays Obsidian-free in unit tests.
