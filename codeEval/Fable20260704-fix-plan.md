# Remediation Plan — terrestrial-brain Code Quality Findings

**Source:** `codeEval/Fable20260704.md` (read it before starting any step — finding IDs like S1, C4, X2 below refer to that document)
**Date:** 2026-07-04
**Structure:** Each numbered step is scoped to exactly ONE OpenSpec (opsx) change. Steps are ordered by dependency and risk. Context will be cleared between steps, so each step is self-contained — a fresh session should be able to execute it after reading this file and the eval document.

---

## Protocol for Every Step (read this first in every session)

1. **Read first:** this file (the step you're executing) and `codeEval/Fable20260704.md` (the findings the step references, for full detail and file:line locations).
2. **Branch:** create the step's feature/bug branch off `develop` (branch name given per step). Never work on `develop` directly.
3. **OpenSpec:** run `/opsx:ff` (these are well-understood changes) to generate proposal, design (incl. user-error scenarios, security analysis, test strategy), test-plan, tasks, and delta specs — then `/opsx:apply`. Never implement manually, never use plan mode.
4. **Bug-fix steps must replicate first:** write the failing test that reproduces the finding BEFORE fixing (per the owner's bug-fix rule). Confirm it fails, then fix, then confirm it passes.
5. **Gates:** after implementation, run the full test suite — `deno test --allow-net --allow-env tests/` (local Supabase stack running via `npx supabase start`; requires `OPENROUTER_API_KEY` until Step 22 lands) AND `cd obsidian-plugin && npm test && npm run build`. Zero failures, zero skips. Note: this repo has no terrestrial-core dependency; the TC-specific package list in global CLAUDE.md does not apply — the layers here are the Deno suite + the plugin vitest suite.
6. **Finish:** `/opsx:verify`, `/opsx:archive`, commit, PR to `develop`. Do not delete the branch.
7. **Track progress:** check the step off in the checklist at the bottom of THIS file (edit it as part of the step's commit).
8. **Migrations are append-only:** never edit an existing file in `supabase/migrations/` — always add a new one (see `docs/upgrade.md`).

**Key paths:**
- MCP server: `supabase/functions/terrestrial-brain-mcp/` (`index.ts`, `helpers.ts`, `logger.ts`, `validators.ts`, `parser.ts`, `tools/*.ts`, `extractors/*.ts`)
- Plugin: `obsidian-plugin/src/main.ts` (+ `main.test.ts`)
- Tests: `tests/integration/*.ts` (Deno)
- Migrations: `supabase/migrations/*.sql`
- Scripts: `scripts/*.sh`

---

## Phase A — Critical security & data-loss (small, independent, urgent)

### Step 1: Fix database security policies
**Findings:** S1, S3 · **Branch:** `bug/DbSecurityPolicies` · **Size:** S · **Depends on:** nothing

- New migration: drop the `people` policy `"Allow all for service role"` (`migrations/20260324000001_people.sql:24-26`) and recreate it with `for all to service_role using (true) with check (true)` — the current policy has no `to` clause and grants anon/authenticated full access to personal data.
- Same migration (or a second one): `revoke execute on function increment_usefulness(uuid[]) from anon, authenticated;` (`migrations/20260404000001` defines it SECURITY DEFINER with default public execute).
- **Tests (write failing first):** integration tests that call the REST API / RPC with the **anon key** and assert denial on `people` reads/writes and on `increment_usefulness`. These are the access-denial tests the owner's GATE 1 rule requires. Verify service-role access still works (existing suite covers this).

### Step 2: ~~Slack request-signature verification on ingest-thought~~ — OBSOLETE
**Findings:** S2 · **Resolution:** The Slack integration (`ingest-thought` Edge Function) was removed entirely in change `remove-slack-integration`, which eliminates finding S2 at the root. No signature-verification work is needed. Step number retained so later cross-references stay valid.

### Step 3: Header-based API authentication (server + plugin)
**Findings:** S4, X4, part of S5 · **Branch:** `feature/HeaderBasedAuth` · **Size:** M · **Depends on:** nothing

- Server (`terrestrial-brain-mcp/index.ts:62-63`): accept the key from an `x-brain-key` header (primary); keep `?key=` working but mark deprecated in README. Use a constant-time comparison (e.g. `crypto.subtle.timingSafeEqual` or a constant-time loop) instead of `!==`.
- Plugin (`obsidian-plugin/src/main.ts` — `buildEndpointUrl`, `callHTTP`, `callIngestNote`, settings tab): send the key as a header, stop embedding it in URLs. Settings migration: if the stored endpoint URL contains `?key=`, extract the key into its own settings field. Warn in the settings tab when the endpoint is not `https://` (allow `http://localhost` / `127.0.0.1`).
- Document the actual trust model in README (single shared secret at the edge; RLS's real role is anon lockout) — fixes the "RLS with access-key authentication" overstatement.
- **Tests:** server integration tests for header auth accept/deny + query-param fallback; plugin vitest for header construction, URL-key migration, and the HTTPS warning.

### Step 4: Soft-archive instead of hard deletes; fix destructive ordering
**Findings:** C2, C3 · **Branch:** `bug/SoftArchiveThoughtDeletes` · **Size:** M · **Depends on:** nothing

- `tools/thoughts.ts:1057-1063` (`handleIngestNote` reconciliation): execute the LLM plan's `delete` list as `update ... set archived_at = now()`, never `.delete()`. An LLM response must never be able to permanently destroy data.
- `tools/documents.ts:307-346` (`update_document`): (a) archive (not delete) the thoughts referencing the document, (b) reorder — update the document FIRST, clean up thoughts only after success, (c) surface (don't `console.error`-and-continue) a cleanup failure in the tool result.
- **Tests (failing first):** ingest a note, re-ingest with content that triggers reconciliation deletes, assert the removed thoughts have `archived_at` set and still exist; `update_document` test asserting old thoughts are archived and that a simulated update failure leaves thoughts untouched. Extend `tests/integration/thoughts.test.ts` / `documents.test.ts`.

---

## Phase B — Test foundation (makes every later step cheaper and verifiable)

### Step 5: Test suite foundation & hygiene
**Findings:** test themes in the eval (copy-pasted `callTool` ×8, order-dependence, vacuous cleanup tests, unit tests in `tests/integration/`, missing deno task, wrong README command) · **Branch:** `feature/TestSuiteFoundation` · **Size:** M–L · **Depends on:** nothing (do before the Phase C bug fixes so they have clean helpers to build on)

- Extract `tests/helpers/mcp-client.ts` exporting `callTool`, `callToolRaw`, `callHTTP`, and shared `SUPABASE_URL`/key constants; replace all 13 inline copies across the 8 test files.
- Make tests self-contained: each test creates its own uniquely-named fixtures and cleans up in `try/finally` (or a small `withFixture` helper). Remove the order-dependence chains (`projects.test.ts:39-50`, `tasks.test.ts:36`, `thoughts.test.ts:738-741`). Delete every vacuous cleanup test (`assertEquals(true, true)` — `extractors.test.ts:1948-1959` and ~9 more).
- Move pure unit tests out of `tests/integration/`: `parse.test.ts` and the non-DB half of `extractors.test.ts` → `tests/unit/`; relocate the stray in-source `extractors/project-extractor.test.ts` content into the Deno unit tree (rewrite its fragile `(globalThis as any).Deno` vitest shim as a plain Deno test).
- Add to root `deno.json`: `"tasks": { "test": "deno test --allow-net --allow-env tests/", "test:unit": "...tests/unit/", "test:integration": "...tests/integration/" }`. Fix `README.md:376` (currently says `npx vitest run` — wrong runner).
- Do NOT touch the hedged `if (!found)` LLM assertions yet — that's Step 22 (needs the stub).
- **Acceptance:** full suite green with the same (or higher) real-assertion count; any single test file runs standalone via `--filter`; no `assertEquals(true, true)` remains.

---

## Phase C — Correctness bugs (each replicated by a failing test first)

### Step 6: Atomic task creation in create_tasks_with_output
**Findings:** C4 · **Branch:** `bug/AtomicTaskCreation` · **Size:** M · **Depends on:** Step 5

- `tools/ai_output.ts:257-419`: validate up front that every `parent_index` refers to an EARLIER index (rejects forward refs and cycles with a clear error instead of silently nulling the parent); on any mid-loop insert failure, delete the already-inserted task IDs before returning the error. Preferred: move the whole create into a single Postgres function (RPC) for true atomicity — decide in design.md and record the trade-off.
- Revisit the magic circular-ref depth cap 10 in `computeTaskDepth` (`ai_output.ts:37`) — with upfront validation it becomes a named constant or goes away.
- **Tests (failing first):** forward `parent_index` → explicit error, zero rows created; simulated failure on task N → tasks 1..N-1 absent afterward; happy-path hierarchy preserved.

### Step 7: Name-matching word boundaries
**Findings:** C5 (+ Unicode nit) · **Branch:** `bug/NameMatchingWordBoundary` · **Size:** S · **Depends on:** Step 5

- `extractors/name-matching.ts:95-103`: tier-1 full-name `indexOf` match must apply the same before/after word-boundary check tier 2 already has (a person "Ann" currently matches inside "Planning"). Extract the boundary check into one shared helper used by both tiers; make it Unicode-aware (`/\p{L}/u`) so accented names ("José") behave.
- **Tests (failing first):** single-word short name embedded in a longer word does NOT match; legitimate boundary-adjacent matches still do; accented-name boundary cases. Extend `extractors/name-matching.test.ts`.

### Step 8: Task-extractor merge semantics & unchecked writes
**Findings:** C6 · **Branch:** `bug/TaskExtractorMergeSemantics` · **Size:** M · **Depends on:** Step 5

- `extractors/task-extractor.ts:635-646`: define the field-by-field merge policy explicitly in design.md. Minimum fix: never overwrite `project_id` with `null` when project resolution ERRORED (LLM failure) rather than concluded "no project"; make the extractor distinguish "resolved to nothing" from "resolution unavailable". Decide and document whether removing a date/assignee from the note clears the stored field (currently: never cleared) — make both directions consistent.
- Check the `error` returned by every Supabase write in Phases 2, 4, 5 (`task-extractor.ts:654-657, 715-718, 725-729`), matching Phase 3's existing pattern; surface failures in the extraction result.
- **Tests (failing first):** re-ingest with LLM unavailable/erroring leaves existing `project_id` intact; the documented clear-semantics for dates/assignees; write-error surfacing (unit-level with a failing stub context).

### Step 9: Date parsing — timezone, bare-ISO, dead code, unit tests
**Findings:** C7, extractor Low findings (bare ISO in URLs, "next Monday", dead `inferDatesFromContent`/`containsDateLikeWords`) · **Branch:** `bug/DateTimezoneHandling` · **Size:** M · **Depends on:** Step 5

- `extractors/date-parser.ts`: thread a user timezone (new env var, e.g. `TB_USER_TIMEZONE`, default UTC) into `extractDueDate`/relative-date resolution — "today"/"tomorrow"/day names computed in that zone, not UTC. Apply the same to the LLM enrichment path's reference date. Decide in design.md whether `due_by` becomes a `date` column (migration) or stays timestamptz with zone-correct midnight — record the trade-off.
- Require a word boundary / nearby marker for the bare ISO pattern (`date-parser.ts:169-176`) so dates inside URLs/version strings aren't captured and stripped.
- Handle or explicitly document `next <weekday>` semantics (`date-parser.ts:206-213`).
- Delete dead exports `containsDateLikeWords` and `inferDatesFromContent` (`date-parser.ts:246-325` — grep-verified unused).
- Add `tests/unit/date-parser.test.ts` using the existing `referenceDate` injection: fixed-date cases for day names, ordinals, year inference around New Year, invalid dates (Feb 30), timezone boundary cases (evening-EST "tomorrow"), URL-embedded dates NOT matching.
- **Tests:** timezone case must fail first against current UTC behavior.

### Step 10: Fail-fast env handling & silent-failure surfacing
**Findings:** C9, X5 · **Branch:** `bug/FailFastEnvAndErrors` · **Size:** M · **Depends on:** Step 5

- Add `requireEnv(name): string` (throws a clear message at cold start) in a shared module; replace every `Deno.env.get(...)!` (`index.ts:24-26`, `helpers.ts:4`, `tools/thoughts.ts:13`, and the four extractor files — note Step 15 will centralize the OpenRouter ones further; here just make them fail fast).
- `helpers.ts:74-105` `extractMetadata`: add the missing `response.ok` check (mirror `getEmbedding`) and log when the `{topics:["uncategorized"]}` fallback triggers.
- `tools/queries.ts` (`get_project_summary` steps 3-6b at 67-155; all of `get_recent_activity` at 287-397) and the name-resolution blocks in `tasks.ts`/`ai_output.ts`/`documents.ts`: stop destructuring only `{ data }` — check `error`, `console.error` it, and render an explicit "(section unavailable: <reason>)" marker instead of a false "No open tasks."
- **Tests (failing first where feasible):** unit test that a missing env var throws at import/startup with the var's name in the message; integration/unit test that a failed sub-query yields the "unavailable" marker, not empty-state prose.

### Step 11: Request-context isolation (IP global, per-request MCP transport)
**Findings:** C8 · **Branch:** `bug/RequestContextIsolation` · **Size:** S–M · **Depends on:** Step 5

- Replace the module-level `setCurrentRequestIp` global (`logger.ts:6-14`, `index.ts:206`) with per-request context — `AsyncLocalStorage` (available in the Supabase edge runtime) or explicit plumbing through Hono context into the logger.
- Follow the MCP SDK stateless pattern: construct the server/transport per request instead of `connect()`ing the shared `McpServer` each time (`index.ts:207-209`) — tool registration moves into a factory called per request (or verify and document why the shared instance is safe if the SDK guarantees it; decide in design.md with evidence).
- **Tests:** two concurrent requests log their own IPs (integration test with distinct `x-forwarded-for` values, assert `function_call_logs` rows); full suite green confirms no regression in tool behavior.

### Step 12: Obsidian plugin sync-reliability bugs
**Findings:** C1, C10, plugin B3/B4 · **Branch:** `bug/PluginSyncReliability` · **Size:** M · **Depends on:** nothing (plugin-side; independent of Deno steps)

- **C1 (failing test first):** make `processNote` return `"synced" | "skipped" | "failed"` (or rethrow when `silent`); the vault-sync command (`main.ts:113-128`) counts from the return value and reports failures — today "✅ Vault sync complete" shows when every note failed because `processNote` swallows its own errors (`main.ts:375-380`) and the `failed++` branch is dead code. The test: mock `callIngestNote` to reject for all files, assert the failure notice — it must fail against current code.
- **C10 (failing test first):** `saveSettings` (`main.ts:492-500`) must stop unconditionally restarting the poll interval (it's called on every sync, every delivery, and every settings keystroke, starving the poll and leaking interval registrations) — only restart when `pollIntervalMinutes` actually changed; separate "persist" from "apply side effects".
- **B3:** wrap the debounce timer body / `vault.read` (`main.ts:209-212, 355`) in try/catch (file deleted during the 5-min delay = unhandled rejection today); cancel pending timers on vault `delete`/`rename`; re-key hashes on rename.
- **B4:** manual "Pull AI Output" shows a `Notice` on failure instead of only `console.error` (`main.ts:257-259`).
- **B5:** define a minimal retry strategy — a failed scheduled sync currently just drops (the note stays unsynced until the next edit); at minimum re-schedule the debounce timer on failure with capped backoff, and document the behavior in the settings description.
- **Plugin S4:** truncate/sanitize server response bodies before embedding them in error `Notice`s (`main.ts:378, 417, 440` — raw bodies, potentially stack traces, are shown to the user today).
- **Tests:** vitest, failing-first for C1 and C10 specifically (the eval notes both are invisible to the current mock-heavy tests — write tests that exercise the REAL `saveSettings`/`processNote` implementations).

### Step 13: Production scripts hardening
**Findings:** C11 + script Low findings · **Branch:** `bug/ProdScriptsHardening` · **Size:** S · **Depends on:** nothing

- `scripts/deploy-update-prod.sh`: exit 1 when any function deploy failed (currently warns and exits 0); move SELinux restore into a `trap ... EXIT` so Ctrl-C can't leave the machine permissive; gate the whole SELinux workaround behind an env flag (e.g. `TB_SELINUX_WORKAROUND=1`); read `PROJECT_REF` from `supabase/.temp/project-ref` or `--output json` instead of awk-matching the `●` glyph; fix the stale `deploy-prod.sh` usage comments (also echoed in `initial-setup-prod.sh:120`).
- `scripts/initial-setup-prod.sh:85-99`: `read -rs` for secrets (no terminal echo); pass secrets as a quoted bash array (`npx supabase secrets set "${SECRETS[@]}"`) or `--env-file` temp file — never unquoted word-splitting.
- **Verification:** shellcheck both scripts clean; dry-run harness or manual walkthrough documented in the change (these scripts have no test suite — say so explicitly in test-plan.md and verify by controlled execution).

---

## Phase D — Structural refactors (safe now that the suite is trustworthy)

### Step 14: MCP response envelope & logging decorator refactor
**Findings:** X1 (envelope ×60, route blocks ×6), server 6.2/6.4, part of X3 · **Branch:** `feature/McpEnvelopeRefactor` · **Size:** M–L · **Depends on:** Steps 5, 10, 11

- Add `textResult(text)` / `errorResult(text)` helpers; make `withMcpLogging` generic (`<Args extends unknown[]>` — removes the four `no-explicit-any` pragmas at `logger.ts:136-144`) and give it the outer try/catch so a throwing handler is logged and returned as a proper MCP error. Then DELETE the ~30 per-handler try/catch blocks and ~60 hand-built envelopes across `tools/*.ts`.
- Collapse the six copy-pasted HTTP route blocks in `index.ts:69-203` into one table-driven `registerHttpRoute` (path → handler + validation), with the `ids`-array validation and log/respond scaffolding existing once.
- Pure refactor: zero behavior change intended — the existing integration suite is the safety net and must stay green untouched (if a test needs changing, that's a red flag to investigate).
- **Acceptance:** suite green with no test modifications; grep shows no remaining inline `isError: true` envelope construction in `tools/`.

### Step 15: AI provider interface & shared LLM client
**Findings:** X2 (partial), X1 (LLM block ×6), extractor dead code · **Branch:** `feature/AiProviderInterface` · **Size:** M–L · **Depends on:** Steps 9, 10

- Define an `AiProvider` interface (e.g. `getEmbedding(text)`, `completeJson<T>(systemPrompt, userContent, validate)`) in the MCP function; implement `OpenRouterAiProvider` once — consolidating the six copy-pasted fetch blocks (`date-parser.ts`, `people-extractor.ts:33-112`, `project-extractor.ts:67-126, 193-258`, `task-extractor.ts:238-301, 387-481`) plus `helpers.ts:54-105`. Single home for the base URL, model name (named constant), lazy `requireEnv` key read, `response.ok` handling, JSON parse/validate/fallback.
- Inject the provider through `ExtractionContext` and tool registration (alongside `supabase`), so extractors and tools receive it rather than importing env at module level — this is the seam Step 22's stub plugs into, so make injection real (no hidden module singletons).
- **Acceptance:** grep shows exactly one `openrouter.ai` literal in the codebase; suite green; extractor unit tests can pass a fake provider (demonstrate with one converted test).

### Step 16: Repository layer — thoughts & tasks
**Findings:** X2 (the core of it) · **Branch:** `feature/RepositoryLayerCore` · **Size:** L · **Depends on:** Step 14 (envelope refactor shrinks the handlers you're about to rewire)

- Define repository interfaces (`ThoughtRepository`, `TaskRepository`) with the operations the tools actually use (create/find/list/update/archive/vector-match/etc.); implement `SupabaseThoughtRepository`/`SupabaseTaskRepository`; inject via tool registration and `ExtractionContext`. Move every inline `supabase.from("thoughts"|"tasks")` in `tools/thoughts.ts`, `tools/tasks.ts`, `helpers.ts`, and `extractors/task-extractor.ts` behind them.
- Add the generic `resolveNames(table, ids): Map<string,string>` capability at the repository/shared level, replacing the inline reimplementation in `tasks.ts:107-125, 305-335` (the remaining copies go in Step 17).
- Pure refactor; integration suite untouched and green. Add unit tests for one or two handlers using a fake repository to prove the seam works.
- **Note for design.md:** keep interfaces minimal (only methods with a current caller — no speculative CRUD surface).

### Step 17: Repository layer — remaining entities & composite queries
**Findings:** X2 (rest), X1 (resolveNames ×8) · **Branch:** `feature/RepositoryLayerRemaining` · **Size:** L · **Depends on:** Step 16

- Extend the pattern: `ProjectRepository`, `PersonRepository`, `DocumentRepository`, `AiOutputRepository`, plus a read-only seam for `tools/queries.ts`. Replace ALL remaining inline `supabase.from(...)` calls in `tools/` and `extractors/` (people/project extractors' create/match writes included).
- Replace the remaining inline name-resolution copies (`queries.ts:139-155, 389-398`, `ai_output.ts:281-318`, `projects.ts:94-101`, `documents.ts:213-220`) with the shared `resolveNames`; delete the now-redundant `resolveProjectNames`.
- **Acceptance:** `grep -rn 'supabase.from(' supabase/functions/terrestrial-brain-mcp/tools/ supabase/functions/terrestrial-brain-mcp/extractors/` returns nothing (all DB access behind repositories); suite green.

### Step 18: Decompose server god-functions
**Findings:** X3 (server half), server 2.2 · **Branch:** `feature/DecomposeServerHandlers` · **Size:** M–L · **Depends on:** Steps 16–17

- `handleIngestNote` (`tools/thoughts.ts:844-1100`, 256 lines) → named steps: `checkUnchanged`, `upsertSnapshot`, `fetchExistingThoughts`, `requestReconciliationPlan`, `executeReconciliationPlan`, `formatIngestSummary`. Unit-test the reconciliation prompt-building and plan execution against fakes (now possible via Steps 15–16).
- `get_project_summary` and `get_recent_activity` (`tools/queries.ts`, ~220 lines each) → `fetchX(deps): DomainData` + `formatX(data): string` split; unit-test the formatters with synthetic data. Extract the duplicated created/updated dedup blocks (`queries.ts:329-341` vs `365-378`) into one `dedupeByName`.
- `update_thought` (`thoughts.ts:584-731`): unify the duplicated content/non-content branches (they differ only in whether embedding + regenerated metadata join the payload).
- `create_tasks_with_output` (`ai_output.ts`): split validation / insertion / formatting (builds on Step 6's logic without changing it).
- Consolidate the three usefulness-reminder variants (`thoughts.ts:14-50` + inline in `queries.ts:246-249, 484-489`) into one builder with a `tone` parameter; if the header+footer double emission in search results is intentional prompt-engineering, add the comment saying so — otherwise emit once.
- **Acceptance:** no function in `tools/` exceeds ~50 lines; suite green untouched; new formatter unit tests added.

### Step 19: Decompose & harden the task extractor
**Findings:** X3 (extractor half), extractor perf Medium (LCS), reconcile duplication, sequential round trips · **Branch:** `feature/DecomposeTaskExtractor` · **Size:** M–L · **Depends on:** Steps 8, 15, 16

- `TaskExtractor.extract` (`extractors/task-extractor.ts:490-734`, ~245 lines, five literal `--- Phase N ---` comments) → one private method per phase: `resolveProjects`, `enrichDatesAndAssignments`, `updateMatchedTasks`, `createNewTasks`, `fixParentLinks`, `archiveRemovedTasks`. Replace the three parallel `Map`s (`contentByIndex`, `dueDateByIndex`, `assignedToByIndex`, lines 552-554) with one `EnrichedCheckbox[]`.
- `reconcileCheckboxes` (lines 107-215): extract the shared `greedyMatch(pairs, scoreFn, threshold)` used by both the similarity and containment passes; EXPORT it and add unit tests covering the 0.8/0.85 threshold boundaries, `stripMarkersForComparison`, `extractAssignment`, `computeSimilarity`.
- Perf: cheap prefilters before the character-level LCS (exact normalized equality, length-ratio bound, token-set Jaccard) — the current O(checkboxes × tasks × len²) ×2 passes can blow edge-function CPU limits on large notes. Fold `parent_id` into the Phase 2 update when already known instead of a second per-task update; batch updates where possible.
- **Acceptance:** re-ingest idempotency tests in `extractors.test.ts` (the strongest existing coverage) stay green untouched; new unit tests for the exported reconciliation helpers; no method over ~50 lines.

### Step 20: Extractor pipeline contracts & parser robustness
**Findings:** extractor Medium (ordering ×4 call sites, side-effect contract, inline types), parser Low (parent detection, bullet chars), missing parser tests · **Branch:** `feature/ExtractorPipelineContracts` · **Size:** M · **Depends on:** Step 19

- Export `createDefaultExtractors()` next to `pipeline.ts`; replace the 4 duplicated `[new ProjectExtractor(), ...]` literals (`tools/documents.ts:49, 324`, `tools/thoughts.ts:485, 889` — line numbers will have shifted; grep for the constructor list). Replace the `"projects"` magic-string coupling with a shared `REFERENCE_KEYS` constant; document the ordering requirement and the side-effect contract ("detect + mutate + enrich") on the `Extractor` interface (`pipeline.ts:32-38`).
- Shared types: reuse `KnownPerson`, add `KnownProject`/`KnownTask` — replace the six inline `{ id: string; name: string }` shapes. Remove the pointless one-line delegation wrappers (`PeopleExtractor.findByName`, `matchPersonInText` — call the shared utility directly).
- Extract shared marker vocabulary (due/by/deadline/before; assigned/owner/assignee) exported from one module, consumed by `date-parser.ts:146` and `task-extractor.ts:96-105, 322` (already drifting).
- Parser (`parser.ts`): parent = nearest preceding checkbox with SMALLER depth (not exactly depth-1 — a 0→2 indent jump currently orphans the subtask), don't scan past section boundaries; accept `*`/`+` bullets in `CHECKBOX_PATTERN:41`; document the 2-space indent assumption vs Obsidian's 4-space default (decide whether to support both in design.md).
- Add `tests/unit/parser.test.ts`: headings/ranges, code fences, indent depths, bullet variants, parent resolution incl. depth jumps.
- Close the remaining extractor test gap flagged in the eval: unit tests for `pipeline.ts` (runner ordering, context enrichment, error propagation — fake extractors) and for `people-extractor`'s deterministic parts (explicit `(assigned:)` markers, validation of LLM output against known-people allowlists — fake `AiProvider` from Step 15). With this, all five previously-untested extractor files (parser, date-parser, task-extractor, people-extractor, pipeline) have coverage across Steps 9, 19, and 20.
- **Tests:** parser parent-detection fix needs a failing test first (it's a behavior bug).

### Step 21: Obsidian plugin modularization
**Findings:** plugin A1–A5, T1, T2, D1, Q1, Q2 · **Branch:** `feature/PluginModularization` · **Size:** L · **Depends on:** Steps 3, 12 (their fixes get carried into the new structure)

- Split `src/main.ts` (802 lines) into: `settings.ts` (types + settings tab), `apiClient.ts` (a `TerrestrialBrainApiClient` INTERFACE + `HttpTerrestrialBrainClient` impl — `callIngestNote` becomes a one-line wrapper over the shared call, killing the A4 duplication), `syncEngine.ts`, `aiOutputPoller.ts`, `confirmModal.ts`, `utils.ts`; `main.ts` becomes a thin composition root. Extract sync/delivery logic behind narrow injected ports (`VaultWriter`, `NoteReader`, `UserNotifier`) — `generateCopyPath`'s injected `existsCheck` is the in-repo pattern to copy.
- `tsconfig.json`: `"strict": true`; fix fallout. Validate server responses at the client boundary with runtime guards instead of `as AIOutputMetadata[]` casts (`main.ts:234, 282`).
- Remove the dead `projectsFolderBase` setting (declared, rendered, persisted, never read — grep-verified) with a settings migration.
- Break up `onload` (~100 lines) and `AIOutputConfirmModal.onOpen` (~95 lines) per the eval's A5.
- Rewrite tests against the extracted modules (the `Object.create(prototype)` fake-plugin hack should mostly disappear); add ONE real integration test in `tests/integration/` that drives the plugin's actual `HttpTerrestrialBrainClient` (imported from the plugin source) against the local Supabase stack — closing the Q1 gap where no test anywhere runs the plugin's real HTTP code against the real backend.
- **Acceptance:** `npm run build` green; vitest green with fewer self-mocks; the new plugin-client integration test passes against the local stack.

---

## Phase E — Deterministic tests & CI

### Step 22: Deterministic LLM/embedding stub mode
**Findings:** X6 · **Branch:** `feature/LlmStubMode` · **Size:** M · **Depends on:** Step 15 (the `AiProvider` seam)

- Add a `FakeAiProvider` selected by env var (e.g. `TB_AI_PROVIDER=fake`) in the edge function: deterministic embeddings (e.g. seeded hash-based vectors so similarity is stable) and canned/deterministic `completeJson` responses sufficient for the extraction and metadata paths.
- DELETE every hedged assertion — the `if (!result.includes("No thoughts found")) {...}` guards at `thoughts.test.ts:69-76, 146-148, 253-256, 343-354, 410-416` and the "LLM may or may not be available" structure-only assertions (`extractors.test.ts:1222-1232`) — replacing them with hard assertions that run against the stub. These are skips wearing a "passed" badge; after this step they must actually verify behavior (GATE 2b: deleting the matching code must fail them).
- Keep a small opt-in live-LLM tier (env-gated job, NOT a skip — a separate explicitly-run task, e.g. `deno task test:live-llm`) and document `OPENROUTER_API_KEY` as its requirement in README.
- **Acceptance:** full default suite passes with NO OpenRouter key set and zero hedged conditionals remaining (grep for `No thoughts found`-style guards).

### Step 23: CI pipeline & one-command dev
**Findings:** X8 · **Branch:** `feature/CiPipeline` · **Size:** M · **Depends on:** Steps 5, 21, 22

- GitHub Actions workflow: `supabase start` (minimal services) with `TB_AI_PROVIDER=fake` → `deno task test` → `deno lint` + `deno fmt --check` (add/commit the lint+fmt config this implies, covering `tests/` too) → `cd obsidian-plugin && npm ci && npm test && npm run build`.
- One-command dev per the owner's standing rule: a `deno task dev` (or root script) that starts the Supabase stack, serves functions, and builds/watches the plugin; matching cleanup on exit (stop emulators/containers).
- **Acceptance:** the workflow passes on the PR itself; `deno task dev` demonstrably starts and cleanly stops everything locally.

---

## Phase F — Hardening & hygiene

### Step 24: Database types & input validation
**Findings:** server 6.1, 6.3, 7.2, 7.3, 5.3 (ilike) · **Branch:** `feature/DbTypesAndValidation` · **Size:** M–L · **Depends on:** Steps 16–17 (types slot into the repositories)

- Generate `supabase gen types typescript` into the function source; type the client `SupabaseClient<Database>`; delete the hand-retyped inline row shapes (`thoughts.ts` ×4 and friends). Wire generation into the dev workflow so it's refreshed on migration changes.
- Zod tightening: `z.enum` for `status`/`type`/`reliability` (values currently only prose in descriptions), `.uuid()` on ALL id params, `.max(100)` on every `limit`.
- Unify conventions (server 7.2): one not-found semantic for get-by-id tools, one zero-fields-update semantic, and affected-row verification on updates (updating a nonexistent UUID currently reports success) — pick the convention in design.md, apply everywhere, update the affected integration tests deliberately.
- Escape `%`/`_`/`\` in user input feeding `ilike` (`documents.ts:196-197` etc.); move `thought_stats`'s load-every-row client-side aggregation (`thoughts.ts:309-315`) into a SQL RPC (new migration).
- **Tests:** invalid enum/uuid/limit rejected with clear messages; nonexistent-UUID update reports not-found; `%` search doesn't match everything.

### Step 25: GDPR data lifecycle
**Findings:** X7 (retention + deletion pathway), DB function_call_logs Lows · **Branch:** `feature/GdprDataLifecycle` · **Size:** M · **Depends on:** Step 21 (plugin structure for the deletion pathway)

- Migration: scheduled purge of `function_call_logs` rows older than a configurable window (30–90 days; `pg_cron` if available on the plan, else a cleanup path invoked from the edge function), an index on `(function_name, called_at)`, check constraints on `function_type`/`function_name` values, and consider truncating stored `input` payloads to a bounded size. Document the retention policy in README.
- Deletion pathway: deleting a note in the vault (or an explicit plugin command, e.g. "Forget this note in Terrestrial Brain") archives-or-deletes the corresponding backend snapshot + thoughts — today `pruneStaleHashes` only forgets the local hash and backend data lives forever. Needs a server-side tool/route + plugin wiring; decide archive vs hard-delete in design.md (GDPR erasure suggests hard delete here — document the tension with the soft-archive convention).
- State the data flow (what leaves the vault, where it goes, how to erase) in the plugin settings description and README.
- **Tests:** deletion pathway integration test (vault delete → backend rows archived/gone); purge function test seeding old rows.

### Step 26: Naming, dead code, and consistency sweep
**Findings:** server 7.1, theme-8 cruft, plugin N1/D2/D3 · **Branch:** `feature/NamingAndDeadCodeSweep` · **Size:** M · **Depends on:** Steps 14–19 (sweep what survives the refactors — much of the offending code will already be gone; this pass catches the rest)

- Mechanical rename pass on the older server files for every single-letter/cryptic name (`q`, `t`, `m`, `r`, `d`, `p`, `c`, `k`, `v`, `o`, `qEmb`, `kids` in `thoughts.ts`, `tasks.ts`, `projects.ts`, `helpers.ts`) and the plugin stragglers (`f`, `t`, `chr`, `opts`, `err`) — match the newer files' convention.
- Fix the `"open-brain"` server name (`index.ts:34`); stale "top 10" comment vs `slice(25)` (`queries.ts:102-112`); name the magic numbers (25, 20, 10, 80 server-side; `60000` ×4 and `2000` plugin-side); `if (!content && content !== "")` → `content === undefined`; fix the misplaced/orphaned JSDoc above `buildEndpointUrl`; comment or replace `simpleHash`'s collision trade-off; drop the stray semicolon (`helpers.ts:20`).
- Zero behavior change; suite green untouched is the acceptance gate. Use `deno lint`/compiler to catch rename slips.

### Step 27: Plugin packaging & config hygiene
**Findings:** plugin C1–C3 · **Branch:** `feature/PluginConfigHygiene` · **Size:** S · **Depends on:** Step 21

- Align `manifest.json` (1.1.0) and `package.json` (0.3.0) versions; add `versions.json`; pin `"obsidian"` (currently `latest`); upgrade esbuild (0.17→current), TypeScript, `@types/node` (18 is EOL) per the owner's latest-stable rule; trim the ~1,400-char manifest description to a sentence or two (move content to README).
- Move the ~25 inline `element.style.*` assignments in the confirm modal to a `styles.css` keyed on the existing `tb-ai-output-*` classes (themes can then override); remove the duplicate `value` assignment (`createEl` option + re-set).
- **Acceptance:** `npm run build` + vitest green after the dependency bumps.

### Step 28: Repo hygiene & schema tidy-up
**Findings:** repo-hygiene Lows, DB naming/nullability drift, match_thoughts convention, metadata dual-format · **Branch:** `feature/RepoAndSchemaTidy` · **Size:** M · **Depends on:** everything else (last)

- Replace the stock Node `.gitignore` with a curated one; remove orphan `tests/node_modules/`; fold `Planning/` into openspec or delete it (ASK the user before deleting — it's their content); dedupe the `openspec/specs/` dir-and-file duplicate entries.
- Cleanup migration: `created_at`/`updated_at` → `NOT NULL` on thoughts/projects/tasks (backfill first); backfill legacy `metadata.references.project_id` string format to the `projects` array format, then simplify the dual-format handling in code and tests; standardize index naming going forward (document the convention — don't rename existing indexes without reason).
- `match_thoughts` convention: create a canonical always-latest copy of the function (declarative schema file or a clearly-marked canonical migration comment) so the source of truth stops being "whichever migration sorts last"; document the convention in `docs/upgrade.md`.
- Curate `.vscode/settings.json` (the `deno.unstable` flag list looks copy-pasted — trim to what's used); mention `scripts/*.sh` in README's setup/deploy section.
- **Acceptance:** full suite + CI green; fresh-install doc walkthrough still works (`docs/fresh-install.md`).

---

## Ordering Rationale

1. **Phase A first** because S1 is an exploitable-now security hole and C2/C3 destroy user data — the steps are small and independent, so nothing justifies delaying them behind refactors. (S2 became moot when the Slack integration was removed.)
2. **Phase B (test foundation) before the bug fixes** so every Phase C fix lands on shared helpers and self-contained fixtures instead of adding to the copy-paste problem.
3. **Phase C before Phase D** because the refactors' only safety net is the test suite — every known behavior bug should be pinned by a passing test before code starts moving between files (a refactor that faithfully preserves a bug is wasted work).
4. **Within Phase D:** envelope refactor (14) shrinks handlers before repositories (16–17) rewire them; the AI provider (15) is independent but must precede the stub (22); decompositions (18–19) need the seams from 15–17; pipeline contracts (20) build on the decomposed extractor; the plugin rewrite (21) carries Steps 3 and 12's fixes into the new structure.
5. **Phase E after D** because the LLM stub requires the `AiProvider` seam, and CI is only worth adding once the suite is deterministic and key-free.
6. **Phase F last** — types/validation slot into the repositories, GDPR's deletion pathway needs the plugin's new structure, and the naming sweep is cheapest after the refactors have already deleted most of the offending code.

## Eval Findings with No Planned Action (deliberate)

These items from `codeEval/Fable20260704.md` are intentionally NOT in any step — do not treat them as omissions:

- **String-brittle test assertions** (tests matching human-facing prose/emoji): the eval itself judged this acceptable coupling for an MCP text protocol. Individual steps may tighten assertions opportunistically, but no dedicated pass.
- **Migration idempotency**: the eval concluded the current approach is adequate for Supabase's linear model — no action required.
- **`documents."references"` reserved-word column**: renaming would require a data migration and touch every consumer for purely cosmetic benefit; live with the quoting.
- **`simpleHash` 32-bit collision risk**: accepted trade-off; Step 26 adds the acknowledging comment rather than switching to `crypto.subtle.digest`.
- **Usefulness reminder as both header and footer of search results**: Step 18 decides intentional-vs-bug and either comments or deduplicates it — listed here because "keep it, with a comment" is an acceptable outcome.

## Progress Checklist

- [x] 1. Fix database security policies (`bug/DbSecurityPolicies`)
- [x] 2. ~~Slack signature verification~~ — obsolete: Slack integration removed (`feature/RemoveSlackIntegration`)
- [x] 3. Header-based API auth (`feature/HeaderBasedAuth`)
- [x] 4. Soft-archive thought deletes (`bug/SoftArchiveThoughtDeletes`)
- [x] 5. Test suite foundation (`feature/TestSuiteFoundation`)
- [x] 6. Atomic task creation (`bug/AtomicTaskCreation`)
- [x] 7. Name-matching word boundaries (`bug/NameMatchingWordBoundary`)
- [x] 8. Task-extractor merge semantics (`bug/TaskExtractorMergeSemantics`)
- [x] 9. Date/timezone handling (`bug/DateTimezoneHandling`)
- [x] 10. Fail-fast env & error surfacing (`bug/FailFastEnvAndErrors`)
- [x] 11. Request-context isolation (`bug/RequestContextIsolation`)
- [x] 12. Plugin sync-reliability bugs (`bug/PluginSyncReliability`)
- [x] 13. Prod scripts hardening (`bug/ProdScriptsHardening`)
- [x] 14. MCP envelope & logging refactor (`feature/McpEnvelopeRefactor`)
- [x] 15. AI provider interface (`feature/AiProviderInterface`)
- [x] 16. Repository layer — thoughts & tasks (`feature/RepositoryLayerCore`)
- [x] 17. Repository layer — remaining entities (`feature/RepositoryLayerRemaining`)
- [x] 18. Decompose server god-functions (`feature/DecomposeServerHandlers`)
- [x] 19. Decompose task extractor (`feature/DecomposeTaskExtractor`)
- [x] 20. Pipeline contracts & parser robustness (`feature/ExtractorPipelineContracts`)
- [x] 21. Plugin modularization (`feature/PluginModularization`)
- [x] 22. LLM stub mode (`feature/LlmStubMode`)
- [x] 23. CI pipeline & one-command dev (`feature/CiPipeline`)
- [x] 24. DB types & input validation (`feature/DbTypesAndValidation`)
- [x] 25. GDPR data lifecycle (`feature/GdprDataLifecycle`)
- [ ] 26. Naming & dead-code sweep (`feature/NamingAndDeadCodeSweep`)
- [ ] 27. Plugin packaging hygiene (`feature/PluginConfigHygiene`)
- [ ] 28. Repo & schema tidy-up (`feature/RepoAndSchemaTidy`)
