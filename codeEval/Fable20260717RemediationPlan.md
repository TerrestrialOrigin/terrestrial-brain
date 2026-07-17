# Terrestrial Brain — Code Quality Evaluation & Remediation Plan

**Date:** 2026-07-17
**Scope:** Full public repo scan — `supabase/functions/terrestrial-brain-mcp/` (core, tools, repositories, extractors, ai), `obsidian-plugin/`, `supabase/migrations|schemas|tests|seed`, `scripts/`, `deno.json`, CI, and the `tests/` suite itself. (`tests/sync-rules/` excluded — deliberately-red PENDING v1.5 suite. `terrestrial-brain-hosting` private repo not in scope of this scan.)
**Method:** Six parallel reviewers, one per area, each auditing against the binding Code Quality Directives (duplication→abstraction, seams, parse-don't-cast, empty-vs-broken, runs-twice/crashes-halfway/interleaves, safety tooling, short functions, bounded queries, security/GDPR, naming, mock-boundary/mutation-check testing rules). Every finding was verified by reading the surrounding code; several extractor findings were additionally verified by executing the real modules under Deno. Findings judged "justified by a nearby design comment" were excluded and are listed at the end under **Deliberate No-Action Items**.
**Context:** This is the first full scan since the 28-step `codeEval/Fable20260704-fix-plan.md` remediation completed. That effort clearly landed — the seams (repositories, AiProvider, request context), the error-envelope consolidation, header auth, constant-time compares, LIKE escaping, and the newer test suites are in good shape. The findings below are mostly (a) new code landed since (quota metering, memory hygiene, lifecycle tests), (b) drift between components the last refactor decoupled, and (c) residual instances of patterns the last sweep fixed elsewhere.

---

## Executive Summary

**103 findings: 9 High · 47 Medium · 47 Low.** No Critical. IDs: CORE (edge-function core + ai/), TOOL (MCP tool handlers), REPO (repositories), EXTR (extractors), PLUG (Obsidian plugin), SQL/SCRIPT (database, shell, config), TEST (test suite).

### The 9 High findings

| ID | One-liner |
|----|-----------|
| CORE-1 | The deterministic AI stub's metadata responder is dead code — its prompt matcher drifted from the real prompt, so `TB_AI_PROVIDER=fake` silently stops exercising metadata enrichment |
| CORE-2 | `resolveDedup` ignores repository error channels — a failed dedup lookup reads as "no duplicate" and admits duplicates |
| CORE-3 | No timeout on outbound OpenRouter HTTP calls — one hang stalls an entire ingest until the platform kills it |
| TOOL-1 | LLM reconciliation plan is `as`-cast, never validated — a hallucinated UUID can irreversibly overwrite or archive an unrelated thought |
| TOOL-2 | `archive_project` swallows traversal errors, archives in a non-recoverable order, and can infinite-loop on a parent cycle |
| EXTR-1 | Marker regexes lack word boundaries — "Attend Derby March 30" becomes task "Attend Der" with a phantom due date (verified by execution) |
| EXTR-2 | Extraction pipeline swallows seed-read errors into empty context — a transient DB error during re-ingest duplicates every checkbox task |
| TEST-1 | The three archival lifecycle tests assert only that the tool *exists*; the coverage manifest claims behavior coverage that isn't there |
| TEST-2 | Task-reconciliation consent tests likewise assert only tool registration — `reconcile_tasks` could auto-close tasks without asking and stay green |

### Cross-cutting themes

1. **Ignored `{ data, error }` channels** — the single most repeated defect (CORE-2, TOOL-2/4/5/7, EXTR-2, REPO-7, PLUG-11). The RepoResult envelope exists; call sites destructure only `data`. Broken renders as empty.
2. **LLM output validated inconsistently** — extractor call sites allowlist ids (good) but the reconciliation plan (TOOL-1), the thought-split callback (CORE-12), and OpenRouter transport responses (CORE-4) are cast, not parsed.
3. **The fake/live AI provider contract has drifted** (CORE-1, CORE-8) — the deterministic stub no longer faithfully reproduces live-provider behavior, which quietly weakens every test that relies on it.
4. **Runs-twice / interleaves unanswered on newer mutation paths** — dedup check-then-insert (TOOL-7), `update_thought` read-modify-write (TOOL-6), auto-create races (EXTR-7), retry re-stamping timestamps (REPO-5), plugin sync re-entry (PLUG-1).
5. **Unbounded queries crept back in** — `list_projects`/`list_people`, seven `get_recent_activity` reads, `get_pending_ai_output_metadata` (REPO-1, TOOL-10, SQL-3).
6. **Test theater in the lifecycle tier** — `hasTool`/`columnExists` probes marked "pass-now" in the manifest (TEST-1/2/3/5); the older integration files never migrated to the self-owned-fixture pattern the newer ones follow (TEST-9/10/12).
7. **The pgTAP suite is orphaned** — six files, zero denial tests, not wired into validate-all.sh or CI (SQL-5, SQL-6): the exact regression class that shipped the original `people` RLS hole.
8. **Deps passed as 8–9 positional parameters** (CORE-7, TOOL-11, EXTR-9) — the options-object rule violated at the composition root and both major pipelines.

---

## Protocol for Every Step (read this first in every session)

1. **Read first:** this file (the step you're executing) — each step lists its finding IDs; the full finding detail (file:line, failure scenario, fix instructions) is in the **Findings Catalog** below in this same document.
2. **Branch:** create the step's feature/bug branch off `develop` (name given per step). Never work on `develop` directly. Never delete branches after merging.
3. **OpenSpec:** run `/opsx:ff` (these are well-understood changes) to generate proposal, design (incl. user-error scenarios, security analysis, test strategy), test-plan, tasks, and delta specs — then `/opsx:apply`. Never implement manually, never use plan mode.
4. **Bug-fix steps must replicate first:** write the failing test that reproduces the finding BEFORE fixing. Confirm it fails for the expected reason, then fix, then confirm it passes (GATE 2b: deleting the fix must re-redden it).
5. **Gates:** after implementation run the full suite — `deno task test` against a freshly reset stack (`npx supabase db reset` first; keep the tree stable during the run) AND `cd obsidian-plugin && npm test && npm run build`, AND `npm run validate` / `scripts/validate-all.sh`. Zero failures, zero skips. This repo has no terrestrial-core dependency; the layers are the Deno suite + the plugin vitest suite + pgTAP (once Step 10 wires it in).
6. **Migrations are append-only:** never edit an existing file in `supabase/migrations/` — always add a new one (see `docs/upgrade.md`). Extend the `supabase/schemas/` canonical-copy convention to any function a new migration re-creates.
7. **Finish:** `/opsx:verify`, `/opsx:archive`, commit, PR to `develop`. Do not delete the branch.
8. **Track progress:** check the step off in the checklist at the bottom of THIS file as part of the step's commit.

---

## Phased Remediation Steps

Each step is scoped to one OpenSpec change. Order within a phase is by risk; phases are ordered so data-integrity fixes land before refactors move the code they pin.

### Phase A — High-severity correctness & data integrity (urgent, mostly independent)

- **Step 1 — `bug/MarkerWordBoundaries`** · EXTR-1 · Size S — word-boundary the due-marker regexes; stop corrupting task text and inventing due dates.
- **Step 2 — `bug/PipelineSeedErrors`** · EXTR-2, EXTR-6 · Size M — abort extraction on failed seed reads; surface extractor write failures to the caller.
- **Step 3 — `bug/ReconciliationPlanValidation`** · TOOL-1 · Size S — Zod-parse + id-allowlist the LLM reconciliation plan before any mutation.
- **Step 4 — `bug/FakeProviderFidelity`** · CORE-1, CORE-8, CORE-12 · Size S — purpose-keyed dispatch in the fake provider; wrap parse errors per contract; harden the split callback.
- **Step 5 — `bug/DedupGateIntegrity`** · CORE-2, TOOL-7, and the DB half of EXTR-7 pairs with Step 11 · Size M — check dedup error channels; partial unique index on `content_hash`; treat 23505 as "already captured".
- **Step 6 — `bug/ArchiveProjectCascade`** · TOOL-2 · Size M — check traversal errors; archive tasks before projects (recoverable order); cycle guard.
- **Step 7 — `bug/OpenRouterTimeoutValidation`** · CORE-3, CORE-4 · Size S — AbortSignal timeouts + schema-validated responses + injectable fetch.
- **Step 8 — `feature/LifecycleTestDepth`** · TEST-1, TEST-2, TEST-3, TEST-4, TEST-5, TEST-6 · Size L — replace `hasTool`/`columnExists` probes with behavioral tests; fix the manifest's testRef checking; clear stale PENDING titles.

### Phase B — Security, GDPR & infrastructure

- **Step 9 — `bug/DbPolicyAndFunctionHardening`** · SQL-1, SQL-4, SQL-8 · Size S — one migration: `to service_role` on the function_call_logs policy, `pg_temp` in search_path pins, weight bounds on `increment_usefulness_weighted`.
- **Step 10 — `feature/PgTapDenialSuite`** · SQL-5, SQL-6, TEST-8 · Size M — RLS denial tests for every table/RPC + pg_policies meta-assertion; wire `supabase test db` into validate-all.sh and CI; extend anon-denial integration coverage beyond `people`.
- **Step 11 — `bug/DedupIndexesAndHashes`** · SQL-2, EXTR-5, EXTR-7 · Size M — `content_hash` partial index; re-stamp `content_hash` on extractor task updates; unique active-project-name index + 23505-recovering create-or-get.
- **Step 12 — `feature/BoundedQueries`** · SQL-3, REPO-1, TOOL-10 · Size M — limits on every list/RPC; `limit + 1` truncation probes; explicit truncation notices.
- **Step 13 — `bug/ProdScriptsSecrets`** · SCRIPT-1, SQL-7 · Size S — secrets via 0600 env-file instead of argv; verify the retention cron job actually exists in prod.
- **Step 14 — `feature/DevStackHygiene`** · SCRIPT-2, SCRIPT-3, SCRIPT-4, SCRIPT-5, SCRIPT-6 · Size M — unique port block, db reset in validate, `npx supabase` everywhere, stale CI comment, re-enable the Deno lockfile.

### Phase C — Error honesty & concurrency (server)

- **Step 15 — `bug/RollbackAndIdempotency`** · TOOL-3, REPO-5 · Size S — check rollback outcomes; make retried mutations idempotent (`.eq("picked_up", false)` etc.).
- **Step 16 — `bug/ErrorSurfacingSweep`** · TOOL-4, TOOL-5, TOOL-12, TOOL-13, REPO-7 · Size M — no more failed-lookup-rendered-as-zero/empty; log best-effort failures; count errors from real outcomes.
- **Step 17 — `bug/UpdateThoughtConcurrency`** · TOOL-6 · Size M — optimistic concurrency (or jsonb_set RPC) on the metadata read-modify-write.
- **Step 18 — `feature/HttpRouteValidation`** · CORE-5, CORE-6, CORE-14, CORE-17, TOOL-15 · Size M — per-route Zod schemas, 400-vs-500 split, logError on throw, idsRoute factory, exact path matching, tighter field schemas.
- **Step 19 — `bug/QuotaMeteringAccuracy`** · CORE-9, CORE-10, CORE-13 · Size S — exclude refused/failed calls from the count; inject the gate through HttpRouteContext; seam the clock.
- **Step 20 — `bug/ExtractorEnrichmentMerge`** · EXTR-3, EXTR-4, EXTR-8, EXTR-10 · Size M — name-matching reuse in assignment; preserve stored values when the LLM omits an entry; element-level parse tolerance; specificity tie-break.

### Phase D — Obsidian plugin

- **Step 21 — `bug/PluginSyncConcurrency`** · PLUG-1, PLUG-8, PLUG-13 · Size M — in-flight guard, unload discipline, scheduler seam.
- **Step 22 — `bug/PluginBoundaryValidation`** · PLUG-2, PLUG-3, PLUG-4, PLUG-6, PLUG-12 · Size M — validate the response envelope, shared `errorMessage`, settings range clamp, refuse cleartext key sends, frontmatter regex fix.
- **Step 23 — `feature/PluginSafetyTooling`** · PLUG-5, PLUG-7 · Size M — ESLint + noUncheckedIndexedAccess + typecheck tests; mutation-resistant tests for poller guard, modal, applyPollInterval, unload.
- **Step 24 — `feature/PluginCleanup`** · PLUG-9, PLUG-10, PLUG-11, PLUG-14, PLUG-15, PLUG-16 · Size S — dedupe entry points and `isRecord`, vault-sync read-failure honesty, options-object modal, settings feedback, naming.

### Phase E — Structure, duplication & style

- **Step 25 — `feature/DepsObjects`** · CORE-7, TOOL-11, TOOL-14, EXTR-9, EXTR-11 · Size M — typed deps objects for `freshIngest`, all `register*`, `handleIngestNote`, the pipeline; extractors wired at the composition root; timezone injected.
- **Step 26 — `feature/FormatterDedup`** · TOOL-8, TOOL-9 · Size M — one task-line renderer; extract thought formatters out of the 1500-line thoughts.ts handlers.
- **Step 27 — `feature/RepositoryShape`** · REPO-2, REPO-3, REPO-4, REPO-6 · Size M — split god-interfaces along their comment boundaries; `runQuery` helper; typed `update` payloads; typed pending-metadata rows.
- **Step 28 — `feature/ExtractorStructure`** · EXTR-12, EXTR-13 · Size M — split task-extractor.ts into four modules; shared LLM prompt-scaffolding helpers.
- **Step 29 — `feature/CoreLowSweep`** · CORE-11, CORE-15, CORE-16, TOOL-16 · Size S — getProjectRefs validation, fence-type tracking, trusted-hop IP extraction, naming.
- **Step 30 — `feature/TestSuiteHygiene`** · TEST-7, TEST-9, TEST-10, TEST-11, TEST-12, TEST-13, TEST-14, TEST-15, TEST-16, TEST-17, TEST-19 · Size L — self-owned fixtures, unique names, shared helpers, move unit-style tests to unit/, kill the silent-pass branch and the fixed sleep.

**Deferred, revisit when Step-7-eval work is scheduled:** TEST-18 (eval tier fixture depth) — no action until the eval seams are wired; see Deliberate No-Action Items.

---

# Findings Catalog

Full detail for every finding referenced by the steps above, grouped by area. Line numbers are as of commit `de845df` on `develop` (2026-07-17).

## Code-Quality Review — `supabase/functions/terrestrial-brain-mcp/` (core files + `ai/`)

### CORE-1 — Fake provider's metadata responder is dead code: prompt-matcher drift silently degrades the deterministic stub

**Severity: High**
**Files:** `supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts:116` (matcher), `supabase/functions/terrestrial-brain-mcp/helpers.ts:130` (real prompt)

`dispatch()` selects the `fakeMetadata` responder via `systemPrompt.includes("Extract metadata from the user's captured")`. The real `extractMetadata` prompt in `helpers.ts:130` begins `"You are given a single captured thought. Produce a JSON object…"` — the matcher substring appears **nowhere** in the codebase outside the fake (verified by grep across all `.ts` files). So under `TB_AI_PROVIDER=fake`, every `extractMetadata` call falls through to the `{}` default, and `coerceThoughtType({})` yields `{ type: "observation" }` with **no `topics`, `people`, `action_items`, or `dates_mentioned` fields at all** — different from both `fakeMetadata`'s output and the documented `UNCATEGORIZED_METADATA` fallback (which includes `topics: ["uncategorized"]`). This breaks the file-header guarantee ("a deterministic value … for every one of the edge function's completion purposes") and is exactly the drift failure mode the Duplication → abstraction rule targets: the discriminator string is duplicated between the real caller and the fake, with no compile-time or test-time link, and it has *already* drifted (fake dated Jul 6, helpers prompt rewritten Jul 12). Failure scenario: the green test suite silently stops exercising the metadata-enrichment path (a GATE 2b gap — deleting `fakeMetadata` changes nothing), and any future test asserting topic tags will chase a phantom bug.

**Fix:**
1. Replace substring dispatch with an explicit discriminator: add an optional `purpose: "extract-metadata" | "split-thoughts" | "reconcile" | "assign-task-projects" | "enrich-tasks" | "project-from-path" | "projects-by-content" | "detect-people"` field to `AiJsonCompletionRequest` in `ai/ai-provider.ts`. Have every real call site set it; have `dispatch()` switch on `request.purpose` and **throw** (not return `{}`) on an unknown purpose so a new call site that forgets to wire the fake fails loudly in tests instead of silently degrading.
2. If you keep substring matching instead, extract each system prompt into a shared exported constant (e.g. `EXTRACT_METADATA_PROMPT` in a `prompts.ts`) imported by both the caller and the fake's matcher, eliminating the duplicated literal.
3. Add a unit test per purpose asserting the fake returns the purpose's non-default shape (e.g. `fakeMetadata` output contains `topics.length >= 1`), and one asserting an unknown purpose throws.

### CORE-2 — `resolveDedup` swallows repository errors into "no duplicate" (empty vs broken)

**Severity: High**
**File:** `supabase/functions/terrestrial-brain-mcp/helpers.ts:94-116`

Both queries destructure only `data` and never check the `error` channel of the `RepoResult` (`const { data: exact } = await thoughtRepository.findByContentHash(…)` at line 99; same for `matchByEmbedding` at line 105 — the repository interface explicitly returns `{ data, error }` per `repositories/thought-repository.ts`). A failed hash lookup or a failed vector-search RPC (DB outage, bad embedding dimension, RPC signature drift) yields `data: null`, which the function reads as `{ duplicateOf: null }` — i.e., "genuinely new content." Failure scenario: during a transient DB error window, the write-time dedup gate (design INVARIANT for capture_thought at `tools/thoughts.ts:714`) silently admits duplicates; the caller has no signal anything failed. This is the exact "catch-to-empty" pattern the directive bans, just spelled as ignored destructuring.

**Fix:**
1. Check `error` on both calls. Decide the policy explicitly and comment it: either (a) throw so `capture_thought` surfaces an error result (recommended — a dedup INVARIANT should not degrade silently), or (b) if degrading is intended, return a discriminated outcome `{ duplicateOf: string | null; dedupUnavailable: boolean }` and have the caller log/annotate.
2. Add a unit test with a fake `ThoughtRepository` whose `findByContentHash` returns `{ data: null, error: {...} }` and assert the chosen behavior (throw / flagged outcome) — verify it fails RED against the current code first.

### CORE-3 — No timeout on outbound OpenRouter HTTP calls

**Severity: High**
**File:** `supabase/functions/terrestrial-brain-mcp/ai/openrouter-provider.ts:49-53, 69-80`

Both `fetch` calls (embeddings and chat completions) have no `AbortSignal`. A hung upstream connection (OpenRouter incident, network black-holing) pins the edge invocation until the platform wall-clock kill, and the client sees an opaque 504/546 instead of the typed `AiProviderHttpError` the seam promises. Worse, `ingest-note` fires several of these per note (split + N × embedding + N × metadata via `freshIngest`), so one hang stalls the whole ingestion with no distinct error. The directives explicitly require explicit timeouts on outbound HTTP.

**Fix:**
1. Add a module constant `const REQUEST_TIMEOUT_MS = 60_000;` (choose per operation: embeddings can be shorter, e.g. 30 s) and pass `signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)` to both `fetch` calls.
2. Catch the resulting `TimeoutError`/`AbortError` and rethrow as `AiProviderHttpError("OpenRouter …", 0, "request timed out after …ms")` (or add a dedicated `AiProviderTimeoutError`) so callers' existing HTTP-failure fallback policies apply unchanged.
3. Unit-test by injecting a never-resolving fetch (this requires making `fetch` injectable — see CORE-4 fix step 3 — or use a local server fixture) and asserting the typed error surfaces within the bound.

### CORE-4 — OpenRouter responses are unvalidated at the boundary; `getEmbedding` can throw untyped errors

**Severity: Medium**
**File:** `supabase/functions/terrestrial-brain-mcp/ai/openrouter-provider.ts:61-62, 92-93`

`getEmbedding` does `const data = await response.json(); return data.data[0].embedding;` with zero validation: (1) an OK-but-non-JSON body makes `response.json()` throw a raw `SyntaxError`, and a shape mismatch (`data.data` missing) throws a raw `TypeError` — neither is one of the two typed errors the `AiProvider` contract (`ai-provider.ts:25, 37-40`) promises, so callers' `instanceof AiProviderParseError` fallback policies never engage; (2) the returned value is `any`-shaped — nothing verifies it is a `number[]` of length 1536, so a malformed upstream payload flows into `thoughtRepository.insert({ embedding, … })` and fails far away as a Postgres `vector(1536)` error (a crash landing far from its cause — the exact thing "parse, don't cast" bans). `completeJson`'s `data.choices[0].message.content` access is at least inside the try mapped to `AiProviderParseError`, but it too relies on incidental `TypeError` rather than a schema check.

**Fix:**
1. In `getEmbedding`, wrap `response.json()` + shape extraction in a try mapped to `AiProviderParseError` (mirroring `completeJson`).
2. Validate the parsed body with a small Zod schema (`z.object({ data: z.tuple([z.object({ embedding: z.array(z.number()).length(1536) })]) })` or equivalent structural checks) before returning; do the same for `choices[0].message.content` being a string in `completeJson`.
3. While in the file, take `fetchImplementation: typeof fetch = fetch` as an optional constructor parameter so the provider passes the "unit test with a fake, no network" litmus — today the transport itself is untestable offline (only its callers are, via `FakeAiProvider`).
4. Add unit tests: OK-status/non-JSON body → `AiProviderParseError`; OK-status/wrong-shape JSON → `AiProviderParseError`; wrong-length embedding → `AiProviderParseError`.

### CORE-5 — HTTP route bodies are cast, not parsed: `as string[]`, `as string | undefined` on raw request JSON; `ids` unbounded

**Severity: Medium**
**File:** `supabase/functions/terrestrial-brain-mcp/index.ts:312-313, 375, 390, 409`

The MCP tools validate inputs with Zod, but the six direct HTTP routes validate by hand and then cast: `title: body.title as string | undefined`, `note_id: body.note_id as string | undefined` (312-313) — a client sending `title: 42` or `note_id: {}` sails through into `freshIngest` and template literals / repository filters. The three `ids` routes check only `Array.isArray(ids)` then cast `ids as string[]` (375, 390, 409) — element types are never checked, so `{"ids":[null,{"x":1}]}` flows objects into `aiOutputRepository` `.in()` filters and fails deep in PostgREST (or worse, matches nothing and reports success with `recordCount: ids.length` — a wrong count computed from the *request*, not from what actually succeeded). The array is also unbounded (rule 8): 100 000 ids build a giant `.in()` URL that fails opaquely.

**Fix:**
1. Define per-route Zod schemas next to `HTTP_ROUTES` (e.g. `IngestNoteBody = z.object({ content: z.string().min(1), title: z.string().optional(), note_id: z.string().optional() })`, `IdsBody = z.object({ ids: z.array(uuidField()).min(1).max(100) })` reusing `zod-schemas.ts:uuidField`).
2. Give each `HttpRoute` a `bodySchema?: ZodType`; have the dispatcher run `safeParse` after `req.json()` and return `{ ok: false, status: 400, error: <flattened issues> }` on failure — this also removes the hand-rolled `content`/`note_id`/`ids` checks (three near-duplicates, see CORE-14).
3. For mark/reject, count from the repository result, not `ids.length` (rule 4: count what actually succeeded).
4. Unit tests: non-string `title`, non-UUID `ids` element, 101-element `ids` → 400.

### CORE-6 — Route dispatcher's catch collapses all thrown errors to an unlogged 500; malformed client JSON also becomes 500

**Severity: Medium**
**File:** `supabase/functions/terrestrial-brain-mcp/index.ts:460-520`

The single `try/catch` around the whole route block has three defects: (1) A handler that *throws* (e.g. `handleIngestNote` propagating an `AiProviderHttpError` from `freshIngest`'s documented throw-on-HTTP-failure path) is caught at 515 **after** `logger.logCall` succeeded — but `logger.logResult`/`logError` is never called, leaving an orphaned `function_call_logs` row with no `error_details` and no result metrics. Telemetry then can't distinguish "crashed" from "in flight", and (per CORE-9) the orphaned row still counts against the AI quota. (2) Malformed request JSON surfaces as `500` rather than `400` — the comment acknowledges this preserves pre-refactor behavior, so noting it as documented-but-wrong: a client error reported as a server error pollutes error budgets and misleads callers. (3) `(error as Error).message` on a non-`Error` throw yields the string `"undefined"` to the client.

**Fix:**
1. Split the parse from the execution: wrap only `context.req.json()` in its own try returning `context.json({ success: false, error: "Invalid JSON body" }, 400)`.
2. Move `logCall` + `route.handle` into a second try whose catch does `if (logId) await logger.logError(logId, message)` before returning the 500 (this is the only current caller-visible use `logError` would have — today it is *never called from index.ts at all*; see it defined at `logger.ts:99`).
3. Normalize the message: `const message = error instanceof Error ? error.message : String(error)`.
4. Integration test: a route handler that throws → 500 response AND a `function_call_logs` row with `error_details` populated.

### CORE-7 — `freshIngest`: 8 positional parameters and ~130 lines; `register*` call sites pass up to 9 positional args

**Severity: Medium**
**Files:** `supabase/functions/terrestrial-brain-mcp/helpers.ts:151-160` and `supabase/functions/terrestrial-brain-mcp/index.ts:153-163, 181-191`

`freshIngest(thoughtRepository, aiProvider, content, title, note_id, noteSnapshotId?, references?, provenance?)` has 8 positional parameters — three of them optional and adjacent, so a call site transposing `noteSnapshotId` and `note_id` (both `string | undefined`) type-checks and silently mis-attributes provenance. The function body also spans ~130 lines with three distinguishable phases (split via LLM; per-thought embed+enrich+insert; summary-message assembly) — the "// Step N is a method name" signal. Same pattern at the composition root: `registerThoughts(server, supabaseClient, callLogger, provider, repos.thought, repos.task, repos.project, repos.person, gate)` — 9 positional args (index.ts:153-163), `registerDocuments` likewise 9 (181-191). The rule is explicit: 4+ positional parameters → typed options/deps object. (Also: `note_id` is a snake_case parameter name in TS code; the naming rule prefers `noteId`.)

**Fix:**
1. Change `freshIngest` to `freshIngest(deps: { thoughtRepository; aiProvider }, input: { content; title?; noteId?; noteSnapshotId?; references?; provenance? })`; update the one caller (`tools/thoughts.ts:1440`).
2. Extract `splitIntoThoughts(aiProvider, content, title): Promise<string[]>` (lines 164-210) and `buildIngestSummary(...)` (lines 256-281) as module-level functions, leaving `freshIngest` as orchestration.
3. Change the `register` signatures (in `tools/*.ts`) to accept a single deps object — `registerThoughts(server, deps: { supabase; logger; aiProvider; thoughtRepository; taskRepository; projectRepository; personRepository; quotaGate })` — and update `createMcpServer` accordingly. Existing tests cover behavior; no new tests needed beyond compile-green + suite green.

### CORE-8 — `FakeAiProvider.completeJson` violates the seam contract: parse failures are not wrapped in `AiProviderParseError`

**Severity: Medium**
**Files:** `supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts:39-45` vs `supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts:37-40` and `openrouter-provider.ts:101-108`

The interface doc promises `completeJson` throws `AiProviderParseError` "when the body is not JSON **or `parse` throws**". The real provider wraps `parse` exceptions accordingly (openrouter-provider.ts:101-108); the fake calls `parse(raw)` bare, so any throw propagates as the raw error. Callers branch on this type: `freshIngest` (helpers.ts:202-210) degrades to single-thought ingestion on `AiProviderParseError` but **rethrows** anything else, aborting ingestion. So the same parse-callback failure produces different observable behavior under fake vs live provider — the stub no longer faithfully exercises the caller's fallback policy, undermining the very purpose of the deterministic stub (and GATE 2b: the degrade branch can't be red/green-tested through the fake).

**Fix:**
1. In `FakeAiProvider.completeJson`, wrap the `parse(raw)` call: `try { return Promise.resolve(parse(raw)); } catch (error) { throw new AiProviderParseError("FakeAiProvider completion", error instanceof Error ? error.message : String(error)); }` (import `AiProviderParseError`).
2. Add a unit test: `completeJson` with a `parse` that throws → rejects with `AiProviderParseError` for **both** providers (shared contract test parameterized over implementations).

### CORE-9 — Quota meter counts refused and failed calls; concurrent at-limit interleaving can wrongly refuse a within-quota call

**Severity: Medium**
**Files:** `supabase/functions/terrestrial-brain-mcp/ai-quota.ts:43-51`, `supabase/functions/terrestrial-brain-mcp/usage-meter.ts:27-38`

`countMeteredCallsSince` counts **every** `function_call_logs` row with a metered name — including rows for calls that were themselves refused over-quota (they are logged first, by design, at index.ts:467 / logger.ts:174 before the gate runs) and calls that errored before consuming any AI. Two consequences, verified against the "gate runs after logCall, `used <= limit`" comment: (1) **Interleaving (rule 5):** with `limit = N` and `N-1` calls used, two concurrent metered calls each insert their log row before either checks; both then count `used = N+1 > N` and **both are refused**, permanently losing one legitimately-in-quota call (its log row keeps counting for the rest of the month). The design comment covers fail-open on meter *failure* but not this over-refusal race. (2) Refused retries inflate `used` in the user-visible message ("you've used 150 of 100") — confusing, though harmless to enforcement. Severity stays Medium because the gate is documented best-effort cost control, but the wrong-refusal case denies service the customer paid for.

**Fix:**
1. Exclude non-consuming rows from the count: add `.is("error_details", null)` to the meter query **and** stop pre-counting the in-flight call (change the gate to `used < limit`), OR keep the current pre-count convention but mark refused calls' log rows (they already get `error_details` via the logging decorator's isError path — verify, then filter them out).
2. Document the residual ±(concurrency) admission window in the `AiQuotaGate.check` doc comment as an accepted tolerance, or eliminate it by counting inside a SQL function that filters errors.
3. Unit tests with a fake meter: at-limit boundary (`used == limit` allowed exactly once), and a test asserting a previously-refused call does not decrement the remaining allowance.

### CORE-10 — `ingest-note` route reaches around its context to a module-level `quotaGate` closure

**Severity: Low**
**File:** `supabase/functions/terrestrial-brain-mcp/index.ts:298` (vs `HttpRouteContext` at 235-245)

Every other dependency a route handler uses is injected through `HttpRouteContext` (supabase, aiProvider, repositories), but the ingest-note handler calls the module-scope `quotaGate` directly. This is a hidden-singleton read mid-logic (rule 2): the `HTTP_ROUTES` table cannot be unit-tested with a fake gate (e.g. asserting the 429 path) without booting the real composition root, and it is the lone asymmetry in an otherwise clean seam design.

**Fix:**
1. Add `quotaGate: AiQuotaGate` to `HttpRouteContext`; pass the instance where the dispatcher builds the context (index.ts:474-484); destructure it in the ingest-note handler.
2. Add a unit test exercising the route table entry with a fake gate returning `allowed: false` and asserting `{ ok: false, status: 429 }`.

### CORE-11 — `getProjectRefs` casts metadata contents instead of validating element types

**Severity: Low**
**File:** `supabase/functions/terrestrial-brain-mcp/helpers.ts:42-48`

`metadata?.references as Record<string, unknown> | undefined` and `refs.projects as string[]` are casts on data that originated outside the process (JSONB written by earlier code versions and by LLM-derived pipelines). If `references` is a legacy scalar or `projects` contains non-strings, the cast hands garbage downstream typed as `string[]` — e.g., an object element flowing into a UUID filter. Contrast with `coerceThoughtType` directly above it, which does this correctly.

**Fix:**
1. Replace with structural checks: verify `refs` via `typeof refs === "object" && refs !== null`; build the result with `refs.projects.filter((entry): entry is string => typeof entry === "string")` (optionally also match `UUID_PATTERN` from `zod-schemas.ts`).
2. Unit tests: `references: "old-string"`, `projects: [42, "uuid"]` → returns only the valid string(s).

### CORE-12 — Thought-split parse callback: `typeof item === "object"` admits `null`, and `Array.isArray` narrowing yields untyped element access

**Severity: Low**
**File:** `supabase/functions/terrestrial-brain-mcp/helpers.ts:184-200`

Inside the `parse` callback, `parsed.thoughts` is narrowed by `Array.isArray` to `any[]`, so `item.thought` compiles with no type safety (an implicit-`any` leak that sidesteps the no-`any` posture without any visible suppression). And `typeof item === "object" && item.thought` does not exclude `null`: an LLM response of `{"thoughts":[null,"real thought"]}` throws `TypeError` reading `.thought` of null — under the live provider that's wrapped into `AiProviderParseError` and collapses the whole note to a single thought (losing the valid split), and under the current fake it aborts ingestion entirely (CORE-8). One malformed element should be skipped, not nuke the batch.

**Fix:**
1. Type the callback input honestly: `const parsed: { thoughts?: unknown } = typeof raw === "object" && raw !== null ? raw as { thoughts?: unknown } : {};` then iterate with `const items: unknown[] = Array.isArray(parsed.thoughts) ? parsed.thoughts : [];` and per-element checks: `typeof item === "string"` else `typeof item === "object" && item !== null && "thought" in item && typeof (item as { thought: unknown }).thought === "string"`. (Cleaner: a Zod schema `z.object({ thoughts: z.array(z.union([z.string(), z.object({ thought: z.string() })])).catch([]) })`.)
2. Unit test through `FakeAiProvider`-style direct invocation of the callback: `[null, "a", {"thought":"b"}, 7]` → `["a","b"]`.

### CORE-13 — `withAiQuota` hardcodes `Date.now()` (clock not seamed at the decorator)

**Severity: Low**
**File:** `supabase/functions/terrestrial-brain-mcp/ai-quota.ts:88-89` (also `index.ts:298`)

`AiQuotaGate.check(nowMs)` correctly takes the clock as a parameter, but both enforcement points (`withAiQuota` and the ingest-note route) call `Date.now()` inline, so the decorator's month-boundary behavior can't be unit-tested at a chosen instant without freezing the global clock. Minor because the gate itself is fully clock-injectable; the decorator is a thin wrapper.

**Fix:** give `withAiQuota` an optional `now: () => number = Date.now` parameter (and thread the same into the route via `HttpRouteContext` alongside CORE-10), then add a month-rollover unit test at the decorator level.

### CORE-14 — Three near-identical `ids` route handlers (Rule-of-Three boundary)

**Severity: Low**
**File:** `supabase/functions/terrestrial-brain-mcp/index.ts:365-416`

`/fetch-ai-output-content`, `/mark-ai-output-picked-up`, and `/reject-ai-output` each repeat the same block: read `body.ids`, `!ids || !Array.isArray(ids)` → 400 `IDS_REQUIRED`, cast `ids as string[]`, call a handler, map `"error" in result`. That is the third real occurrence — the extraction threshold. The mark/reject pair is verbatim-identical except the handler function. (The table-driven dispatcher itself is a good prior extraction; this is the residue inside it.)

**Fix:** add a small factory `function idsRoute(suffix: string, logName: string, run: (repo: AiOutputRepository, ids: string[]) => Promise<…>): HttpRoute` and declare the three entries through it. Folds naturally into the CORE-5 Zod-schema change (`IdsBody` validated once in the dispatcher). Existing route tests cover behavior.

### CORE-15 — Markdown fence detection ignores fence type: a `~~~` line inside a ``` block closes it

**Severity: Low**
**File:** `supabase/functions/terrestrial-brain-mcp/parser.ts:45, 54-78`

`FENCE_PATTERN` matches either ` ``` ` or `~~~` and `detectCodeBlockLines` toggles `inBlock` on any match, without remembering which fence opened the block. Per CommonMark (and Obsidian's renderer), a block opened with ` ``` ` is only closed by a ` ``` ` fence — a literal `~~~` line inside it is content. With the current code, that `~~~` line closes the block, and subsequent code lines containing `- [ ]` or `#` are parsed as real checkboxes/headings — phantom tasks extracted from code samples, the precise failure the code-block skip exists to prevent.

**Fix:**
1. Track the opening fence: change `inBlock: boolean` to `openFence: "```" | "~~~" | null`; on a fence match, open when `null`, close only when `match[2] === openFence`, otherwise treat the line as in-block content.
2. Unit tests: a ``` block containing a `~~~` line plus a `- [ ] fake task` line → zero checkboxes; and the mirror case.

### CORE-16 — `extractIpAddress` trusts client-spoofable headers for logged telemetry

**Severity: Low**
**File:** `supabase/functions/terrestrial-brain-mcp/logger.ts:26-43`

The first `x-forwarded-for` element is client-controlled unless a trusted proxy strips/rewrites it; `x-real-ip`/`cf-connecting-ip` likewise. Any caller can thus plant an arbitrary string (including junk or someone else's IP) into `function_call_logs.ip_address`, polluting the abuse-attribution trail this column exists for. Since Supabase's edge gateway appends the true client IP as the *last* XFF hop, taking the first element specifically prefers the spoofable end of the chain. Low because it is telemetry behind an authenticated endpoint, not an authorization input — but it degrades exactly the forensic signal it is meant to provide. (GDPR note: IP is personal data; the existing 10k-char input cap comment shows minimization was considered — verify retention policy covers `ip_address` too.)

**Fix:** prefer the last XFF element (or, better, the platform-verified header for the deployment target — document which proxy chain is trusted in a comment), and validate the candidate against an IPv4/IPv6 shape before storing, else `null`. Unit tests: spoofed multi-hop XFF, garbage value → stored value is the trusted hop / null.

### CORE-17 — Route matching by `pathname.endsWith(suffix)` matches unintended nested paths

**Severity: Low**
**File:** `supabase/functions/terrestrial-brain-mcp/index.ts:455-458`

`url.pathname.endsWith("/ingest-note")` matches `/functions/v1/terrestrial-brain-mcp/anything/deeper/ingest-note` — any depth of prefix. All such requests are already behind the access-key gate and hit the same handler, so there is no privilege issue, but a typo'd client path silently "works," and a future route whose suffix is a suffix of another (e.g. adding `/note` alongside `/ingest-note` — order-dependent with `Array.find`) would misroute. The comment explains why raw-URL matching is used (Supabase may not pass subpaths to Hono's router) — the mechanism is accepted; the looseness is not required by it.

**Fix:** match exactly one segment: compute `const relativePath = url.pathname.split("/").filter(Boolean).pop()` and compare `relativePath === route.name` (store `suffix` without the slash), or use a regex anchored to `^(?:/functions/v1)?/terrestrial-brain-mcp/<suffix>$`. Add a unit-level test for the matcher with a nested bogus path expecting MCP fallthrough (which then 4xx's on non-MCP payloads).

### Verified non-findings (accepted by design, listed to preempt re-flagging)

- **Constant-time key compare** (`index.ts:209-225`): hash-then-XOR-fold is correctly constant-time and length-channel-free. Compliant with rule 9.
- **AsyncLocalStorage request context** (`requestContext.ts`): correctly removes the prior module-mutable IP race (documented as finding C8); no request-scoped data remains in module mutables.
- **Quota fail-open** (`ai-quota.ts:52-59`): explicitly documented design decision (D5) with rationale; not an error-swallow violation — the failure is logged and the degradation direction (allow, never wrongly block) is reasoned.
- **Logged input contains note content**: capped at 10 000 chars with explicit truncation marker (`logger.ts:10-22`, documented as data-minimization finding X7) — a deliberate, bounded design decision, though retention policy should be confirmed elsewhere.
- **`validators.ts` path traversal**: `..` segments are rejected (incidentally but reliably) by the "must not end with a period" rule; leading `/` and empty segments are explicitly rejected. The single `deno-lint-ignore no-control-regex` carries an inline justification, per the safety-tools rule.
- **`usage-meter.ts` head-count query**: filtering and counting are pushed into the query (`count: "exact", head: true` over an indexed pair) — compliant with rule 8.
- **Malformed-JSON → 500** is acknowledged in a comment as intentional behavior preservation; still recommended for change in CORE-6 but not a silent defect.

---

## Code-Quality Review — `supabase/functions/terrestrial-brain-mcp/tools/`

### TOOL-1 — High — LLM reconciliation plan is cast, never validated (parse-don't-cast violation on a mutation path)

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:1215`, `thoughts.ts:1285-1299`

`requestReconciliationPlan` returns the LLM's JSON via `(raw) => raw as ReconciliationPlan` (line 1215) — a bare cast with zero runtime validation, on output that directly drives DB mutations in `executeReconciliationPlan`: `thoughtRepository.update(updateItem.id, …)` (line 1262) and `thoughtRepository.archive(id)` (line 1321). This violates the binding rule "validate LLM outputs against allowlists so a hallucinated value can't flow into a mutation." Failure scenarios: (a) a plan item missing `content` sends `undefined` into `getEmbedding()`/`hashContent()` and crashes far from the cause; (b) `keep`/`update`/`delete` returned as non-arrays (e.g. `"delete": "all"`) — `plan.delete || []` only guards null/undefined, so iterating a string archives per-character "ids"; (c) an `update`/`delete` id that is a valid UUID but not one of this note's thoughts **irreversibly overwrites or archives an unrelated thought** — `update` replaces content, embedding, and content_hash with no history. Line 1285-1288 compounds it with a double cast: `(addItem as unknown as { thought: string }).thought || addItem` can pass a non-string object as `content` to `insert`. The `AiProviderParseError` catch only covers unparseable JSON, not wrong shape.

**Fix:**
1. Define a zod schema next to `ReconciliationPlan`: `keep`/`delete` as `uuidField().array()`, `update` as `z.object({ id: uuidField(), content: z.string().min(1) }).array()`, `add` as `z.string().min(1).array()`; use `.catch`/`safeParse` inside the `completeJson` parse callback and throw `AiProviderParseError` (→ existing fresh-ingest fallback) on failure.
2. After parsing, intersect every id in `update`/`delete` (and `keep`) against `existingThoughts.map(t => t.id)` as an allowlist; drop (and log) any id not in the set so a hallucinated UUID can never reach `update`/`archive`.
3. Delete the `as unknown as { thought: string }` branch at 1285-1288 — the schema guarantees strings.
4. Tests: unit tests feeding `requestReconciliationPlan`'s parser (via a stub AiProvider) a plan with (a) missing `content`, (b) `delete` containing a foreign UUID, (c) non-array fields — assert fallback/filtering; a mutation check that removing the allowlist intersection turns test (b) red.

### TOOL-2 — High — `archive_project`: swallowed traversal errors + non-recoverable crash-halfway ordering, reported as full success

**File:** `supabase/functions/terrestrial-brain-mcp/tools/projects.ts:329-366`

Three defects in one multi-step mutation. (1) *Swallowed errors:* line 332-338 destructures only `{ data: childProjects }` from `listActiveChildIds` — a failed query yields `frontier = []`, silently terminating descendant discovery; line 353 likewise drops the error from `findOpenIdsByProjects`, so a failed task lookup archives zero tasks. Both paths then return `Archived project "X"` — a partial failure rendered as complete success (the exact "✅ complete because the loop ended" anti-pattern). (2) *Crashes halfway is unrecoverable:* projects are archived first (`archiveManyActive`, line 344), tasks second (line 360). If the function dies (or the task step errors) in between, a re-run's `listActiveChildIds` finds no active children — they are already archived — so `allProjectIds = [id]` and the descendants' open tasks can **never** be archived by retrying. The required "crash leaves a RECOVERABLE state" analysis comment is absent. (3) The `while (frontier.length > 0)` loop has no visited-set and no depth bound; `update_project` (line 273) sets `parent_id` with no cycle check, so a user/LLM-created parent cycle makes this loop spin until the edge-function wall clock kills it.

**Fix:**
1. Check the error channel of both `listActiveChildIds` and `findOpenIdsByProjects`; on error, return `errorResult` (nothing has been archived yet at discovery time, so aborting is clean).
2. Reverse the recovery problem: collect all project ids and all open task ids FIRST, archive tasks, then archive projects last — a crash between the two leaves projects still active, so re-running rediscovers and finishes (order so the interrupted state is retryable); or move the whole cascade into a single Postgres RPC (recursive CTE + two updates in one transaction), which also fixes (3).
3. Add a `Set` of visited ids in the traversal (skip already-seen ids) and reject `parent_id` values in `update_project` that create a cycle (walk ancestors of the proposed parent).
4. Tests: integration test where the child-project query fails (fake repository) → expect errorResult, no archive writes; test that a cyclic parent graph terminates; test that re-running after a simulated failure between the two archive steps completes the task archiving.

### TOOL-3 — Medium — `create_tasks_with_output`: rollback failure unchecked, response falsely claims "tasks rolled back"; retry duplicates tasks

**File:** `supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts:468-478`

When the `ai_output` insert fails after tasks were inserted, line 471 runs `await taskRepository.deleteByIds(taskIds);` and **discards the result** — then unconditionally returns `"Failed to create AI output (tasks rolled back): …"`. If the compensating delete fails, orphan task rows remain while the tool asserts they were removed. This is inconsistent with `insertTasksAtomically` (lines 216-231 in the same file), which carefully checks its rollback error and reports possibly-orphaned ids. Separately, the tool's runs-twice story is unaddressed: the description says `reference_id = file_path` dedupes *re-ingestion* of the delivered markdown, but a client retry of the tool call itself (timeout after tasks inserted, before response received) inserts a second full set of task rows with the same `reference_id` — no idempotency key, no pre-check.

**Fix:**
1. Capture `{ error: rollbackError }` from `deleteByIds` at line 471; when set, change the message to the WARNING form used by `insertTasksAtomically` (include the orphaned ids) — better, extract that rollback-and-report block into a shared helper used by both sites (it is currently the 2nd near-copy).
2. For runs-twice: before inserting, query `taskRepository.findByReference(file_path)` (already exists) and either refuse with a clear "tasks for this file_path already exist" error or return the existing ids — a comment answering the three-questions checklist should be added either way.
3. Tests: unit test with a fake repository whose `deleteByIds` fails → assert message contains the orphan warning, not "rolled back"; test that a second identical call does not double-insert.

### TOOL-4 — Medium — Failed sub-lookups rendered as empty/zero in `get_project`, `get_person`, `list_projects`

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/projects.ts:191-202, 110-122`; `supabase/functions/terrestrial-brain-mcp/tools/people.ts:139-147`

The repo went to the trouble of building `renderSectionBody` (section-format.ts) precisely so "broken" never renders as "empty" (finding C9), but these handlers still destructure only `{ data }`: `get_project` drops errors from `findName` (line 192), `listChildrenBasic` (199), and `countOpenByProject` (202) — a failed count renders as `Open tasks: 0`, indistinguishable from genuinely zero; `get_person` line 139 does the same with `countOpenByAssignee` → `Open tasks assigned: 0` on a failed query; `list_projects` line 111 drops the `listChildParentIds` error so child counts silently vanish. Failure scenario: a transient PostgREST error makes the model tell the user "no open tasks on this project" — a wrong answer with no trace.

**Fix:**
1. In each site, destructure `{ data, error }`, `console.error` with a context label, and render an explicit unavailable marker (`Open tasks: ? (lookup failed)` / omit-with-warning), mirroring the `"?"` convention already used in queries.ts (`## Open Tasks (?)`).
2. Tests: unit tests with fake repositories returning `{ data: null, error }` for the count → assert output contains the unavailable marker, not `0`.

### TOOL-5 — Medium — `touchRetrieved` result discarded without even logging; silent failure feeds the stale/archival review queues

**File:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:311, 466, 567`

All three retrieval sites call `await thoughtRepository.touchRetrieved(ids);` and drop the returned `{ error }` entirely. The nearby comment ("best-effort; a touch failure never breaks the read") justifies not failing the read — it does not justify zero observability, and the same file logs the analogous best-effort `incrementUsefulness` failure at lines 572-578, so this is an inconsistency, not a design choice. Failure scenario: if the `last_retrieved_at` update breaks (RLS/grant regression — a class this project has actually hit per the Supabase CLI/DML memory), every thought silently stops accruing retrieval recency; `get_stale_thoughts`/`get_archival_queue` (which filter on `last_retrieved_at`, lines 1004-1007, 1034-1037) then present actively-used thoughts as stale/archival candidates, and a user consenting to that queue archives live knowledge — with no log line ever hinting why.

**Fix:**
1. At each of the three sites: `const { error: touchError } = await …; if (touchError) console.error(...)` — or wrap in a tiny shared `touchRetrievedLogged(repo, ids, context)` helper since this is now three copies (Rule of Three).
2. Test: unit test with a fake repository whose `touchRetrieved` errors → assert the read still succeeds AND the error is logged (spy on console.error).

### TOOL-6 — Medium — `update_thought` read-modify-write on `metadata` with no optimistic concurrency (interleaves lose data)

**File:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:832-855` (with `buildThoughtUpdate` 78-158)

The handler fetches `existing.metadata`, merges new references/fields into it in memory (`buildThoughtUpdate` spreads `existingMetadata`), then writes the whole metadata object back via `thoughtRepository.update` keyed only on `id`. Two interleaved updates — realistic here because the tool is explicitly multi-actor (`actor: LLM | user | sync`, i.e. the console, connectors, and the model all drive this same path per the schema description at line 809-811) — each read the same snapshot; the second write overwrites the first's `references.projects`/`references.documents` wholesale. This is exactly the directive's "Interleaves? … use optimistic concurrency (version/etag) where last-write-wins would lose data," and no comment addresses it.

**Fix:**
1. Add a guard column (`updated_at` works if trigger-maintained, or an explicit integer `version`): `findForUpdate` selects it, `ThoughtRepository.update` gains an `expectedVersion` filter (`.eq("id", id).eq("version", expected)` and `.select("id")`), and the handler returns a "concurrent edit — re-read and retry" error when zero rows match.
2. Alternatively (smaller): move the reference merge into a Postgres RPC that does `metadata = jsonb_set(metadata, '{references,projects}', …)` atomically, so concurrent non-content updates cannot clobber each other.
3. Tests: integration test issuing two updates from the same read snapshot; assert the second is rejected (or both reference sets survive), and that removing the version filter turns it red (GATE 2b).

### TOOL-7 — Medium — Write-time dedup: check-then-insert race, and dedup-query errors silently mean "no duplicate"

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:709-733`; `supabase/functions/terrestrial-brain-mcp/helpers.ts:94-116` (`resolveDedup`, on the capture_thought path)

Two issues in the "server-side dedup gate" that capture_thought advertises as an invariant. (1) *Interleaves:* `resolveDedup` then `insert` is a classic check-then-insert; two concurrent `capture_thought` calls with identical content both pass the gate and both insert — nothing at the DB level (no partial unique index on `content_hash where archived_at is null and superseded_by is null`) enforces the invariant. The project memory even records "dirty-stack dedup collisions" being observed. (2) *Empty vs broken:* `resolveDedup` destructures only `{ data: exact }` and `{ data: near }` — if `findByContentHash` or `matchByEmbedding` **errors**, the failure is silently interpreted as "genuinely new" and a duplicate is inserted; a broken dedup query is indistinguishable from a clean miss. (Related, smaller: `checkUnchanged` at thoughts.ts:1115 also drops its lookup error — degrades to re-ingest, lower stakes.)

**Fix:**
1. Add a partial unique index on `thoughts(content_hash) WHERE archived_at IS NULL AND superseded_by IS NULL` (migration), and in `capture_thought`/`freshIngest` treat the unique-violation error code (23505) as the existing "Already captured" success path — this makes exact dedup atomic under concurrency.
2. In `resolveDedup`, check both `error` channels; on error, log and return a distinct outcome (e.g. `{ duplicateOf: null, degraded: true }`) so `capture_thought` can append a "dedup check unavailable" note instead of silently claiming the gate ran.
3. Tests: integration test firing two identical captures concurrently → exactly one active row; unit test where `findByContentHash` errors → assert the degradation is logged/surfaced.

### TOOL-8 — Medium — Third+ copy of the task-line renderer (Rule of Three violated in the same file that extracted it)

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/tasks.ts:37-69` (shared `renderTaskLine`) vs `tasks.ts:556-586` (`get_tasks` inline copy) vs `supabase/functions/terrestrial-brain-mcp/tools/queries.ts:283-295` (project-summary open-task lines)

`renderTaskLine` was extracted precisely "so a task looks identical wherever it appears," yet `get_tasks` in the same file re-implements it line-for-line (identical status-icon ternary, `ID: … | Status: …`, project/assignee lines, due/overdue logic) plus two extra lines (parent task, archived date), and queries.ts carries a fourth variant of the status-icon + due/overdue block. This is past the extraction threshold ("extract on the THIRD real occurrence at the latest; never write a 4th copy"). Failure mode is the usual drift: an overdue-logic fix (e.g. the `status !== "done"` guard, which queries.ts:287 already **lacks** — a done-but-listed task there would still print OVERDUE; currently masked because that query filters to open/in_progress) lands in one copy and not the others.

**Fix:**
1. Extend `TaskLineContext` with optional `parentNames?: Map<string,string>` and a `showArchived?: boolean` flag (or add optional fields to the row type) and make `get_tasks` call `renderTaskLine`, appending only what is genuinely extra.
2. Export a tiny `taskStatusIcon(status)` + `formatDueDate(due_by, status)` pair from tasks.ts and use them in queries.ts's open-task renderer instead of the inline ternary/overdue expression.
3. Tests: existing pure-formatter unit tests extended to cover parent/archived lines through `renderTaskLine`; assert get_tasks output unchanged byte-for-byte for a fixture task.

### TOOL-9 — Medium — `search_thoughts` / `list_thoughts` / `get_thought_by_id`: duplicated thought-formatting blocks inside ~115-line handlers

**File:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:228-239 vs 402-414` (verbatim collect-project-uuids preamble), `260-271 vs 438-448` (verbatim provenance block), `272-297 vs 592-604` (+ variant at 757-769) (topics/people/actions/projects lines)

The project-reference collection + `resolveNames` preamble is copied verbatim between search_thoughts and list_thoughts; the reliability/author provenance block is copied verbatim; the Topics/People/Actions metadata lines appear in three renderers (search, get_thought_by_id, and a delimiter-variant in capture_thought's confirmation). That is the third real occurrence of each. It also makes both handlers ~110-115 lines of mixed fetch + format + side-effects (touch, reminder assembly), well past the ~30-40-line single-purpose checkpoint — while queries.ts in the same directory demonstrates the intended fetch/format split (`fetchProjectSummary` / `formatProjectSummary`, pure and unit-tested). thoughts.ts is 1500 lines largely because these render bodies live inline in `register`.

**Fix:**
1. Extract module-level pure helpers: `collectProjectRefs(rows): string[]`, `formatProvenance(thought): string | null`, `formatThoughtMetadataLines(metadata, projectNameMap): string[]`, then `formatSearchResult(thought, index, map)` / `formatListEntry(thought, index, map)` composed from them (preserve byte-for-byte output, as the codebase's other refactors did).
2. Shrink each registered handler to: query → error/empty envelope → resolve names → `touchRetrieved` (logged, per TOOL-5) → `textResult(format…)`.
3. Tests: unit tests on the extracted formatters with fixture rows (including missing metadata fields); snapshot the pre-refactor output first so equivalence is proven.

### TOOL-10 — Medium — Unbounded list queries reachable from tools: `list_projects`, `list_people`, and most `get_recent_activity` sub-queries have no LIMIT

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/projects.ts:87-91` + `repositories/supabase-project-repository.ts:33-47`; `supabase/functions/terrestrial-brain-mcp/tools/people.ts:76-79` + `repositories/supabase-person-repository.ts:30-41`; `supabase/functions/terrestrial-brain-mcp/tools/queries.ts:378-421` + `repositories/supabase-query-repository.ts:133-216`; `supabase/functions/terrestrial-brain-mcp/tools/tasks.ts:620-627`

"Every list has an explicit limit" is violated in several tool-reachable paths: `list_projects` and `list_people` accept no `limit` input and their repositories issue no `.limit()` — every row is fetched and rendered into the MCP text payload. In `get_recent_activity`, only `listRecentThoughts` is capped (20); `listTasksCreatedSince`, `listTasksCompletedSince`, `listProjectsCreated/UpdatedSince`, `listPeopleCreated/UpdatedSince`, and `listDeliveredAiOutputsSince` are all unbounded — and the tool's `days` param has no schema maximum, so `days: 36500` fetches the entire tables. (The nearby comment at queries.ts:638-644 justifies not *rejecting* out-of-range `days` input; it does not address the absence of query-level bounds, which is the requirement's other half.) Also `reconcile_tasks` hardcodes `limit: 100` with no truncation detection — at exactly 100+ open tasks the cap is silent, contradicting "any cap/truncation is explicit and logged" (contrast `handleOpenTasksByProject`'s `limit + 1` probe in the same file).

**Fix:**
1. Add a `limit` (zod-bounded, `MAX_QUERY_LIMIT`, sensible default) input to `list_projects` and `list_people` and thread it into the repository queries; report truncation via the `limit + 1` probe pattern already established in `listIncompleteUnarchived`.
2. Cap every `…Since` query in `supabase-query-repository.ts` (e.g. 50 per section, a named constant) and have `formatRecentActivity` render `## Tasks Created (50+)`-style explicit truncation.
3. Give `reconcile_tasks` the `limit + 1` probe and append a "more exist — narrow by project" note when capped.
4. Tests: unit test each section formatter with `limit+1` rows → truncation notice present; schema test that `days` beyond the new max is clamped/rejected.

### TOOL-11 — Medium — 8-9 positional parameters on `register`/`handleIngestNote` (options-object rule)

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:160-170` (9 params), `thoughts.ts:1386-1398` (`handleIngestNote`, 7 positional deps + args), `supabase/functions/terrestrial-brain-mcp/tools/documents.ts:22-32` (9 params); also `helpers.ts:151-160` (`freshIngest`, 8 positional)

The directive "4+ positional parameters → a typed options/deps object" is exceeded more than twofold. These are same-typed repository parameters (`taskRepository, projectRepository, personRepository, …`) — the highest-risk shape for silent transposition: swapping two repositories at a call site type-checks if their structural methods overlap and fails only at runtime, far from the cause. Every new dependency (the recent `quotaGate` addition is visible at position 9) forces edits to every call chain.

**Fix:**
1. Define a shared `interface ToolDeps { supabase; logger; aiProvider; thoughtRepository; taskRepository; projectRepository; personRepository; documentRepository; aiOutputRepository; noteSnapshotRepository; queryRepository; quotaGate }` (composition root already builds all of these in `index.ts`); change each `register(server, deps: Pick<ToolDeps, …>)` and `handleIngestNote(deps, args)` / `freshIngest(deps, options)` accordingly.
2. Named-field construction makes transposition impossible; no behavior change, so existing tests stand — add a compile-only check that each register receives its `Pick`.

### TOOL-12 — Low — Extraction-pipeline failure silently degraded in `capture_thought` and `write_document`, but surfaced in `update_document` (inconsistent partial-failure honesty)

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:683-689`; `supabase/functions/terrestrial-brain-mcp/tools/documents.ts:89-97` vs `documents.ts:358-367`

All three handlers catch `runExtractionPipeline` failures. `update_document` appends a user-visible `" (warning: reference extraction failed — references reset to empty)"`; `capture_thought` and `write_document` only `console.error` and proceed, so their confirmations ("Captured as observation — …", "Document stored …") read as full success while task/project/person references were silently dropped. Absence-of-references (nothing detected) and failure-to-extract render identically to the caller — the model will conclude the note simply mentioned no tasks.

**Fix:**
1. Mirror update_document: capture a `pipelineWarning` string in the catch blocks at thoughts.ts:683 and documents.ts:89 and append it to the success confirmation.
2. Tests: unit test with a throwing pipeline stub → confirmation contains the warning; mutation check: deleting the warning append reddens it.

### TOOL-13 — Low — `executeReconciliationPlan` (and `freshIngest`) discard rejection reasons — "N failed" with no diagnosable cause

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:1329-1332`; `supabase/functions/terrestrial-brain-mcp/helpers.ts:249-254`

Both `Promise.allSettled` sites count `status === "rejected"` but never read `result.reason`. The counts are honest (good — partial failure is reported), but every failure message the ops carefully constructed (`Update failed for <id>: …`) is thrown away, so a recurring ingest failure ("2 failed" on every sync) is undiagnosable from logs.

**Fix:**
1. After `allSettled`, iterate rejected results and `console.error(...)` the reason (ids only are embedded in those messages — no note content, consistent with the logging-minimization stance).
2. Test: unit test with one failing op → spy asserts the reason is logged and the summary still says "1 failed".

### TOOL-14 — Low — Inline `createDefaultExtractors()` at four call sites instead of one composition-root wiring

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:675, 1421`; `supabase/functions/terrestrial-brain-mcp/tools/documents.ts:81, 349`

The extractor set is constructed mid-handler in four places rather than injected once ("wired at ONE composition root"). Consequence: a unit test of `capture_thought`/`write_document`/`update_document` cannot substitute a fake extractor set (only the deeper supabase/aiProvider seams), and a future change to the default set requires touching every call site. Not severe — the factory is deterministic — but it is both a seam gap and a 4th copy of the same construction.

**Fix:**
1. Build the extractor array once in `index.ts` (or accept an `extractors` field on the `ToolDeps` object from TOOL-11) and pass it through `register` into the handlers; keep `createDefaultExtractors()` as the composition root's default.
2. Test: existing pipeline tests unchanged; add a unit test injecting a fake extractor into `capture_thought`'s handler to prove the seam.

### TOOL-15 — Low — Weakly-validated boundary fields: `due_by` as bare string, `email` without email validation, `parent_index` unconstrained in zod

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/tasks.ts:293, 421`; `supabase/functions/terrestrial-brain-mcp/tools/people.ts:31, 174`; `supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts:385-390, 396-399`

"Validate ONCE at the door" is diluted for several fields: `due_by` is `z.string()` — an LLM-hallucinated `"next Tuesday"` reaches Postgres and fails with a cryptic timestamptz parse error (or a subtly-wrong implicit parse) instead of a clean boundary rejection; `email` is `z.string()` with no `.email()`, so junk is stored; `parent_index` is `z.number()` with the integer/range checks done imperatively later in `validateParentIndices` (works, but the zod boundary admits `1.5` only to reject it two layers down, and line 424's `tasks as TaskInput[]` cast exists partly to paper over the schema/type mismatch).

**Fix:**
1. `due_by: z.string().datetime({ offset: true })` (both create_task and update_task's nullable variant, and create_tasks_with_output's task objects); `email: z.string().email().nullable()`; `parent_index: z.number().int().min(0)` (keep the earlier-task/ordering checks in `validateParentIndices` — those are cross-field and belong there).
2. Remove the `tasks as TaskInput[]` cast by deriving `TaskInput` from the zod schema (`z.infer`).
3. Tests: schema unit tests rejecting `"tomorrow"`, `"not-an-email"`, `1.5`.

### TOOL-16 — Low — Naming: single-letter comparator params and abbreviated identifiers

**Files:** `supabase/functions/terrestrial-brain-mcp/tools/tasks.ts:148`; `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts:755, 1250-1252`

`groups.sort((a, b) => a.rank - b.rank || a.sortKey.localeCompare(b.sortKey))` uses single-letter non-numeric parameters, violating the no-single-letter rule (contrast queries.ts:154, which correctly writes `(thoughtA, thoughtB)`). `thoughts.ts:755` names a metadata record `meta` and `executeReconciliationPlan` takes `ctx: ReconcileContext` — both abbreviations whose full names are well under 30 characters (`metadataRecord`/`extractedMetadata`, `context`).

**Fix:** Rename to `(groupA, groupB)`, `context`, and `extractedMetadata` respectively. Pure renames; no test changes needed beyond compilation.

### Explicitly checked, no finding (patterns that pass)

- Error-envelope duplication: consolidated in `mcp-response.ts` (`textResult`/`errorResult`) and used consistently.
- LIKE/ilike escaping: `escapeLikePattern` correctly applied to both `list_documents` filters in the repository; no other user text reaches LIKE.
- Usefulness-reminder duplication: consolidated in `usefulness-reminder.ts`; empty-vs-broken section rendering consolidated in `section-format.ts` and used throughout queries.ts.
- Logging of personal content: tool input logging is capped and documented (logger.ts X7 note); log lines in tools carry ids/messages, not note content.
- `forget_note`: delete order (thoughts before snapshot), idempotency, and hard-delete exception are all explicitly designed and correct.
- `update_document` ordering and `insertTasksAtomically` rollback reporting are compliant models the fixes above should copy.
- `queries.ts` `reference_id!` (line 684) is guarded two lines up; not flagged.

---

## Repositories & Extractors — `repositories/` + `extractors/`

(Three behavioral bugs — EXTR-1, EXTR-3 — were verified by executing the real modules under Deno, not just by reading.)

### REPO-1 — Medium — Unbounded list queries across five repositories

**Files:**
- `supabase/functions/terrestrial-brain-mcp/repositories/supabase-person-repository.ts:30-41` (`list`), `:82-88` (`listActive`)
- `supabase/functions/terrestrial-brain-mcp/repositories/supabase-project-repository.ts:33-47` (`list`), `:122-128` (`listActive`)
- `supabase/functions/terrestrial-brain-mcp/repositories/supabase-ai-output-repository.ts:29-37` (`listPending`)
- `supabase/functions/terrestrial-brain-mcp/repositories/supabase-query-repository.ts:65-76` (`listOpenTasksForProject`), `:133-216` (seven `*Since` methods)

`TaskListFilters`, `DocumentListFilters`, and `ThoughtListFilters` all carry a `limit` and their implementations apply it — but `PersonListFilters` and `ProjectListFilters` have no limit field, `listPending` returns every pending ai_output row **including full content**, and seven of the eight `get_recent_activity` reads apply `.gte(since)` but no `.limit(...)` (only `listRecentThoughts` is capped at 20). Callers add no limit either. Failure scenario: after a year of ingests, `get_recent_activity` with a wide window, or `list_people`/`list_projects`/the ai-output pull API, fetches the entire table into the edge function's memory and the MCP response.

**Fix:**
1. Add `limit: number` to `PersonListFilters` and `ProjectListFilters`; apply `.limit(filters.limit)` in both implementations; give the `list_people`/`list_projects` tools a `limit` input with a default (e.g. 100) as `list_tasks` already has.
2. Add `.limit(n)` (a shared constant) to the seven unbounded `*Since` methods, plus `listOpenTasksForProject` and `listPending` — fetch `limit + 1` and let the handler report truncation, the pattern already used by `listIncompleteUnarchived` in `supabase-task-repository.ts:57-78`.
3. `listActive` seeds the extractor context and is arguably whole-table by design, but give it an explicit high cap with a logged truncation rather than a silent full scan.
4. Tests: integration tests seeding `limit + 1` rows and asserting the result is capped and truncation is reported, per repository method. (Coordinates with TOOL-10 and SQL-3 — implement together in Step 12.)

### REPO-2 — Medium — Seam interfaces far exceed the 3–5-method narrow-interface rule

**Files:** `repositories/query-repository.ts:91-146` (20 methods), `repositories/thought-repository.ts:125-222` (19 methods), `repositories/task-repository.ts:76-141` (13 methods)

`QueryRepository` is a god-interface spanning six tables for three unrelated tools; its own comment blocks already partition it into three concerns (`// get_project_summary`, `// get_recent_activity`, `// get_note_snapshot`) — a comment-as-structure smell analogous to `// Step N` inside a function. `ThoughtRepository` mixes search, CRUD, review queues, usefulness scoring, and GDPR erasure. Every fake in tests must stub ~20 methods to exercise one.

**Fix:**
1. Split along the existing comment boundaries: `ProjectSummaryReads`, `RecentActivityReads`, `NoteSnapshotReads` — separate interfaces, all still implemented by the one `SupabaseQueryRepository` class (`implements A, B, C`), with each tool handler receiving only the interface it needs.
2. Split `ThoughtRepository` similarly (search/retrieval, write path, review queues, usefulness, erasure).
3. No behavior change; update the fakes in `tests/` to implement only the narrowed interface their test touches.

### REPO-3 — Low — `{ data, error: toRepoError(error) }` wrapper repeated ~45 times

**Files:** every `supabase-*-repository.ts`, e.g. `supabase-task-repository.ts:32,54,77,87,100,108,117,126,136,148,156,164,174` and equivalents in the other seven implementations.

The trailing two lines of nearly every method are the identical await-then-wrap block, ~45 occurrences. Any change to the envelope policy (logging every repo error, adding a `details` field to `RepoError`) is a 45-site edit.

**Fix:**
1. Add to `repo-result.ts` a helper `async function runQuery<Data>(builder: PromiseLike<{ data: Data | null; error: { message: string; code?: string } | null }>): Promise<RepoResult<Data>>` and rewrite methods as `return runQuery(this.supabase.from("tasks").select(...).single());`. Void-returning writes get a `runWrite` variant.
2. Existing repository tests cover the refactor; add one unit test for the helper's error path.

### REPO-4 — Low — `update(id, updates: Record<string, unknown>)` is an untyped hole through the seam

**Files:** `repositories/task-repository.ts:100-103`, `person-repository.ts:68-71`, `project-repository.ts:72-76`, `document-repository.ts:66-69`, `thought-repository.ts:192-195`

Step 24 introduced schema-derived DTOs "so shapes can no longer drift from the database", but all five `update` methods accept an arbitrary string-keyed bag — a typo'd or nonexistent column name compiles and only fails at runtime as a PostgREST error (or silently writes the wrong column). Extractor and tool handlers build these bags free-form (e.g. `task-extractor.ts:1043-1063`).

**Fix:**
1. Change each signature to `update(id: string, updates: Partial<UpdateRow<"tasks">>)` using the existing typegen aliases in `supabase-client.ts` (add an `UpdateRow<Table>` alias next to `InsertRow`). The jsonb `metadata` field needs the same documented one-line bridging the insert paths already use.
2. Callers' object literals then get excess-property checking for free. Compile-time change; existing tests cover behavior.

### REPO-5 — Low — Non-idempotent timestamp overwrites on retried mutations

**Files:** `repositories/supabase-ai-output-repository.ts:57-63` (`markPickedUp`), `:65-71` (`reject`); `supabase-task-repository.ts:103-109` (`archive`), `:151-157` (`archiveMany`); `supabase-person-repository.ts:74-80`; `supabase-thought-repository.ts:247-253`

`markPickedUp` sets `picked_up_at: new Date().toISOString()` unconditionally — a retried pull-API request (at-least-once client semantics) re-stamps `picked_up_at` forward, and since `listDeliveredAiOutputsSince` filters on `picked_up_at >= since`, an already-reported delivery re-appears in `get_recent_activity`. The `archive` family likewise overwrites `archived_at` on re-run, corrupting the original archival time. `archiveIfActive` (`supabase-task-repository.ts:111-118`) and `archiveManyActive` (`supabase-project-repository.ts:113-120`) already show the correct claim-style pattern.

**Fix:**
1. Add `.eq("picked_up", false)` to `markPickedUp`, `.eq("rejected", false)` to `reject`, and `.is("archived_at", null)` to the four plain archive methods (matching `archiveIfActive`).
2. Add an integration test per method: call twice, assert the timestamp from call 1 is unchanged after call 2.

### REPO-6 — Low — `listPendingMetadata` leaks `unknown[]` through the seam to the API response

**Files:** `repositories/ai-output-repository.ts:34`, `supabase-ai-output-repository.ts:39-43`; consumer `tools/ai_output.ts:256-258`

The interface returns `Promise<RepoResult<unknown[]>>` and the handler serializes `data || []` straight into the pull-API response — no shape ever validated or typed, unlike `thought_stats` in `supabase-thought-repository.ts:25-36` which zod-parses its RPC result. A schema drift in the `get_pending_ai_output_metadata` RPC would silently change the API contract with the desktop pull client.

**Fix:**
1. Define `PendingAiOutputMetadataRow` from the generated `Database["public"]["Functions"]["get_pending_ai_output_metadata"]["Returns"]` type (the pattern already used for `ThoughtMatchRow` in `thought-repository.ts:21-24`), or zod-parse like `thought_stats`.
2. Update the interface signature; add a unit test with a fake returning a malformed row asserting the error path.

### REPO-7 — Low — Count methods return `data: 0` alongside a non-null error

**Files:** `repositories/supabase-task-repository.ts:120-127` (`countOpenByProject`), `:129-137` (`countOpenByAssignee`)

`return { data: count ?? 0, error: toRepoError(error) };` — on a query failure `count` is null, so the envelope carries **both** `data: 0` and an error. Every other method keeps `data` null when `error` is set; this is the one place where "broken" is indistinguishable from "empty" for a caller that reads `data` without checking `error` (and TOOL-4 shows the callers do exactly that).

**Fix:**
1. `return error ? { data: null, error: toRepoError(error) } : { data: count ?? 0, error: null };`
2. Unit test with a failing fake asserting `data === null` when `error` is set.

### EXTR-1 — High — Marker regexes lack word boundaries: real task text is corrupted and phantom due dates invented

**Files:**
- `supabase/functions/terrestrial-brain-mcp/extractors/date-parser.ts:258-319` (all six `DATE_PATTERNS` interpolate `markerPattern` with no leading boundary)
- `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts:239-266` (`stripMarkersForComparison`, same defect plus over-broad `\w+`)
- `supabase/functions/terrestrial-brain-mcp/extractors/markers.ts:21` (`DUE_MARKER_PATTERN` is a bare alternation)

`DUE_MARKER_PATTERN` = `(?:due|by|deadline|before)` and every consuming regex allows it to match mid-word. **Verified by executing the real modules:** `extractDueDate("Attend Derby March 30")` → `{cleanedText: "Attend Der", dueDate: "2027-03-30..."}` — the "by" inside "Derby" matched, so the stored task content becomes "Attend Der" **and** a due date the user never wrote is persisted. `extractDueDate("Test standby 2026-08-01 procedure")` → `{cleanedText: "Test standprocedure", ...}`. Additionally, `stripMarkersForComparison`'s fourth replace uses `\w+` where a month name is intended, so `"Review by section 3 of the doc"` → `"Review of the doc"` (verified) — this skews reconciliation similarity and can cause a re-ingested checkbox to miss its stored task and create a duplicate. This corrupts user data on the primary ingest path.

**Fix:**
1. In `date-parser.ts`, prepend `(?<![\p{L}\p{N}])` (with the `u` flag) — or `\b` if ASCII suffices — before `${markerPattern}` in patterns 1, 3, 4, 5, 6, and require at least one whitespace between marker and value (`\s*:?\s*` → `\s*:\s*|\s+`) so `"by2026-08-01"` inside a token can't match. Either document in `markers.ts` that consumers must add boundaries, or export boundary-wrapped variants.
2. Apply the same leading boundary to all four replaces in `stripMarkersForComparison`, and replace the `\w+` in the fourth replace with `(?:${monthPattern})` (export `monthPattern` from `date-parser.ts` or move it to `markers.ts`).
3. Tests (write failing first): add to `tests/unit/date-parser.test.ts`: "Attend Derby March 30" (no date, content intact), "standby 2026-08-01" (no strip), "Rugby Friday", plus positive controls ("finish by Friday" still parses); add "Review by section 3" to `tests/unit/task-extractor-merge.test.ts` asserting `stripMarkersForComparison` leaves it unchanged.

### EXTR-2 — High — Pipeline swallows repository errors into an empty context → duplicate tasks/projects on transient DB failure

**File:** `supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts:137-184`

`runExtractionPipeline` destructures only `data` from `projectRepository.listActive()`, `personRepository.listActive()`, and `taskRepository.findByReference()` — the `error` channel of all three is discarded without even a log — then coalesces to empty arrays. Failure scenario: a transient DB error on `findByReference` during re-ingest yields `knownTasks = []`, so `reconcileCheckboxes` matches nothing and `createNewTasks` inserts a **duplicate task for every checkbox in the note** — the highest-severity bug class the directives call out. Similarly, a failed `listActive()` yields `knownProjects = []`, so `matchOrCreateProject` auto-creates duplicate projects. The pipeline's own doc comment promises failures are "surfaced by the runner rather than swallowed", but that only covers extractor write errors, not these three seed reads.

**Fix:**
1. Check all three errors before building the context. Because proceeding with an empty seed is *never* safe (it converts a read failure into duplicate writes), abort: have `runExtractionPipeline` return a discriminated result (`{ ok: true; references } | { ok: false; error }`) or throw a typed `PipelineSeedError`, and make the four callers (`tools/documents.ts:79,348`, `tools/thoughts.ts:674,1421`) surface it as an errorResult instead of ingesting.
2. Tests (write failing first): unit test with fake repositories returning `{ data: null, error }` from each seed read, asserting no extractor runs and no insert is attempted. The unit-level fake is the right layer — the repository seam is exactly what makes it possible.

### EXTR-3 — Medium — `extractAssignment` assigns the wrong person: first-in-list substring containment, no ambiguity guard

**File:** `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts:559-574`

The explicit-marker fast path compares `candidateName.includes(personLower) || personLower.includes(candidateName)` and returns the **first** hit in list order. **Verified:** `extractAssignment("Fix bug (assigned: Bo)", [Bob Smith, Bo Diddley])` returns Bob Smith's id — the exact-match person loses to an accidental containment purely because of array order. This duplicates matching logic that `name-matching.ts` already implements correctly (exact tier first, then a partial tier that returns null on ambiguity). A task gets silently assigned to the wrong person and, via the merge policy, can overwrite a correct stored `assigned_to` on re-ingest.

**Fix:**
1. Replace the loop body with `const personId = findPersonByName(match[1].trim(), knownPeople);` from `./name-matching.ts` (exact match wins; ambiguous partials return null, falling through to the AI path which has section-heading context to disambiguate). Keep the marker-stripping behavior on success.
2. Tests: exact name beats containment regardless of list order; ambiguous short candidate ("(assigned: Jo)" with "Jo Ann" and "Joan") returns null.

### EXTR-4 — Medium — LLM response omission clears stored `due_by`/`assigned_to` on matched tasks

**File:** `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts:903-917` (`enrichDatesAndAssignments`), `:1004-1028` (`applyAiEnrichment`), `:1051-1063` (merge application)

The `*Unavailable` flags are set only when the enrichment call did **not run**. If the call ran but the model returned no entry for a given `task_index` — plausibly because the completion truncated at max-tokens on a large note — `state.dueDate`/`state.assignedTo` remain null with the flags false, and `applyMergeField` (`:511-519`) then **clears** the stored `due_by`/`assigned_to` of the matched task. An *absent entry* is not an affirmative "nothing found" — the prompt's contract (`:651`) is one entry per task with explicit nulls. (For project inference the prompt explicitly says "omit it" for no-match, so clearing on omission there is documented design — this finding is scoped to `inferTaskEnrichments`.) Failure scenario: user re-syncs a 60-checkbox note, the enrichment response truncates after 40 entries, and 20 tasks silently lose their due dates and assignees.

**Fix:**
1. In `applyAiEnrichment`, collect the set of `taskIndex`es actually present in the parsed response; in `enrichDatesAndAssignments`, mark `dateUnavailable`/`personUnavailable` when the field is unresolved **and** (`!enrichmentRan` OR the candidate's index is missing from the response set). Distinguish "entry present with `due_date: null`" (clear) from "entry absent" (preserve).
2. Extend `tests/unit/task-extractor-merge.test.ts` with a fake AiProvider returning enrichments for only a subset of candidates, asserting omitted tasks keep their stored values.

### EXTR-5 — Medium — TaskExtractor writes `content` without re-stamping `content_hash` (INVARIANT 1 skew)

**File:** `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts:1043-1044` (`updateMatchedTasks`), `:1098-1105` (`createNewTasks`)

`tasks.content_hash` exists (`migrations/20260712000001_memory_hygiene.sql:12` — "stamped in the one server-side update path so the sync dedup gate operates on current text — INVARIANT 1"), and `update_task` maintains it on every content edit (`tools/tasks.ts:437-440`). But the extractor's Phase-2 update rewrites `content` with no `content_hash`, leaving a **stale** hash that no longer matches the row's text — worse than a null hash, because a dedup gate comparing against it gets a confident wrong answer.

**Fix:**
1. In `updateMatchedTasks`, when setting `updates.content`, also set `updates.content_hash = await hashContent(state.content)` (import `hashContent` from `../helpers.ts`); do the same in `createNewTasks`'s insert. Add `content_hash?: string` to `NewTaskValues` in `task-repository.ts:41-51`.
2. Add an assertion to `tests/integration/extractors.test.ts`: after re-ingest changes a task's content, `content_hash` equals the SHA-256 of the new content.

### EXTR-6 — Medium — Extractor write failures never reach the caller; two extractors never report them at all

**Files:** `extractors/pipeline.ts:189-203` (runner logs `result.errors` to console, then drops them); `extractors/people-extractor.ts:155-158,185-188` and `project-extractor.ts:277-280,317-320` (auto-create failures go to `console.error` only; `ExtractionResult.errors` never populated)

"A function that can partially fail must RETURN its outcome." `TaskExtractor` dutifully accumulates `run.errors`, but the runner reduces them to a console line, so `handleIngestNote`/`update_document` report full success while task updates silently failed. Worse, `PeopleExtractor` and `ProjectExtractor` don't populate `errors` at all. Failure scenario: an RLS/permission regression makes every `people` insert fail; ingest keeps returning success, and the knowledge base silently stops learning people.

**Fix:**
1. Have `PeopleExtractor.createPerson` and `ProjectExtractor.matchOrCreateProject` push failure messages into a per-run errors array returned via `ExtractionResult.errors` (mirror `TaskExtractor`).
2. Change `runExtractionPipeline` to also return the collected errors (`{ references, errors }`), and have the four call sites append a "partial failure" warning to the tool response when non-empty.
3. Tests: unit tests with a fake repository whose `insert` fails, asserting `errors` is populated and propagated to the pipeline's return value.

### EXTR-7 — Medium — Auto-create is not safe against interleaving: duplicate projects, dropped people

**Files:** `extractors/project-extractor.ts:288-321` (`matchOrCreateProject`); `extractors/people-extractor.ts:165-189` (`createPerson`)

Verified against migrations: (a) `projects.name` has **no unique constraint** (`migrations/20260321000001_projects.sql:3`), so two concurrent ingests of notes under `projects/Acme/` both miss in the in-memory `knownProjects` snapshot and insert **two "Acme" rows**; every later heading/path match then picks one arbitrarily. (b) `people.name` **is** unique (`migrations/20260324000001_people.sql:4`), so the losing racer's insert fails with a unique violation — and `createPerson` just logs and returns null, silently dropping the person reference instead of recovering.

**Fix:**
1. New migration: unique index on active projects, e.g. `unique (lower(name)) where archived_at is null` (matching the case-insensitive matching the extractor already does).
2. In both auto-create paths, on insert error check for Postgres code `23505` (`toRepoError` already surfaces `code`) and recover by re-querying the row by name (add `findByName(name)` to `PersonRepository`/`ProjectRepository`) and returning its id — create-or-get becomes idempotent under races.
3. Tests: integration test firing two concurrent ingests referencing the same new project/person name, asserting exactly one row exists and both runs got the same id.

### EXTR-8 — Low — LLM parse callbacks: `as` casts + one malformed element poisons the whole batch

**Files:** `extractors/task-extractor.ts:471-487, 657-687`; `extractors/people-extractor.ts:72-86`; `extractors/project-extractor.ts:89-97, 202-209`

To their credit, all five callbacks allowlist ids against `validIds` before anything reaches a mutation. But they validate via `raw as {...}` casts plus per-field `typeof` checks that dereference properties on unchecked elements: if the model returns `{"enrichments": [null, {...ok...}]}`, `entry.task_index` on `null` throws inside `parse`, `completeJson` wraps it in `AiProviderParseError`, and the catch discards the **entire batch** instead of skipping the one bad element. Zod is already a dependency.

**Fix:**
1. Define zod schemas per response — or simpler: `safeParse` each array element and keep only successes — keeping the existing `validIds` allowlist filtering on top.
2. One shared helper for "parse array, drop invalid elements, allowlist ids" would also collapse the five hand-rolled variants (see EXTR-13).
3. Unit tests: fake provider returning arrays containing `null`, wrong-typed fields, and hallucinated ids; assert valid elements survive and invalid ones are dropped.

### EXTR-9 — Low — Pipeline runner: 7 positional params, and a dead `supabase` handle on the context

**File:** `extractors/pipeline.ts:127-135` (signature), `:62` (`ExtractionContext.supabase`)

`runExtractionPipeline(note, extractors, supabase, aiProvider, taskRepository, projectRepository, personRepository)` violates the options-object rule at four call sites. Separately, `ExtractionContext.supabase` is consumed by **no extractor** (verified: zero `context.supabase` hits) — a raw untyped DB handle on the context is a standing invitation to bypass the repository seam.

**Fix:**
1. Change the signature to `runExtractionPipeline(note, extractors, deps: ExtractionPipelineDeps)`; delete `supabase` from `ExtractionContext` and the deps entirely.
2. Update the four call sites in `tools/documents.ts` / `tools/thoughts.ts`. Compile-time refactor; existing extractor integration tests cover it.

### EXTR-10 — Low — `findPersonInText` tier-1 tie-break prefers list order over specificity

**File:** `extractors/name-matching.ts:139-151`

On equal earliest position, `position < earliestPosition` is strict, so the **first person in array order** wins. With known people "Ann" and "Ann Smith" and text "Ann Smith called", both match at index 0; if "Ann" is earlier in the (unordered) list, the task is assigned to the wrong, less-specific person.

**Fix:**
1. Track `earliestLength` alongside position; replace the winner when `position < earliestPosition || (position === earliestPosition && nameLower.length > earliestLength)`.
2. Add a unit test to `tests/unit/extractor-helpers.test.ts` with both orderings of ["Ann", "Ann Smith"] asserting "Ann Smith" wins.

### EXTR-11 — Low — Hidden env read inside extraction logic (`getConfiguredTimeZone`)

**File:** `extractors/date-parser.ts:130-133`; consumed at `task-extractor.ts:828`

`TaskExtractor.createRun` calls `getConfiguredTimeZone()` which reads `Deno.env.get("TB_USER_TIMEZONE")` per extraction run — a hidden singleton read mid-logic. Tests must mutate process-global env to exercise timezone behavior, and the config surface is invisible at the composition root.

**Fix:** Read `TB_USER_TIMEZONE` once in `index.ts` alongside the other env reads, thread it into the pipeline deps object (do together with EXTR-9), and have `createRun` take it from `run.context`. Existing date-parser unit tests already pass `timeZone` explicitly, so only the wiring changes.

### EXTR-12 — Low — `task-extractor.ts` at 1166 lines bundles four separable modules

**File:** `extractors/task-extractor.ts` (whole file; section banners at :34, :87, :129, :224, :418, :497, :536, :577, :696, :760)

Individual functions are mostly within the 30–40-line checkpoint (the phase methods were properly extracted), so this is file-level cohesion: similarity/LCS + prefilters, greedy matching + reconciliation, LLM inference prompts, and the extractor class are four independent units sharing almost no private state. The ten `// ────` section banners are the file-level analogue of `// Phase N` comments.

**Fix:** Split into `similarity.ts` (normalize/LCS/prefilters/`computeSimilarity`), `task-reconciliation.ts` (`greedyMatch`, `stripMarkersForComparison`, `reconcileCheckboxes`), `task-inference.ts` (the two LLM calls), keeping `task-extractor.ts` as the class + merge policy. Pure moves with re-exports; existing unit tests pin behavior.

### EXTR-13 — Low — Prompt-scaffolding boilerplate duplicated across five LLM call sites (rule of three exceeded)

**Files:** the `- "name" (id: ...)` entity-list builder (4 copies: `people-extractor.ts:44-50`, `project-extractor.ts:182-188`, `task-extractor.ts:448-454`, `:611-617`); the `validIds` Set (4 copies, same sites); the `try { completeJson } catch { console.error(...); return sentinel; }` frame (5 copies)

Four-to-five occurrences of each block is past the extract-on-third threshold; the copies have already begun to drift (some return `{ ok: false }` to distinguish transport failure, others flatten to `[]` — precisely the drift that produced EXTR-4's preserve-vs-clear subtlety).

**Fix:** Add `extractors/llm-helpers.ts` with `formatEntityList(entities)`, `buildIdAllowlist(entities)`, and a `callJsonWithFallback<T>(aiProvider, request, parse, fallback, label)` wrapper owning the catch/log; rewrite the five sites on top. Behavior-preserving; covered by existing extractor unit tests plus the new EXTR-8 tests.

### Repositories/extractors — explicitly checked and passed

- **No repository bypasses:** zero Supabase query-builder calls outside `repositories/` across `tools/`, `extractors/`, `index.ts` — the seam holds.
- **`as unknown as` casts** in `supabase-task-repository.ts:26`, `supabase-thought-repository.ts:51,231` each carry inline typegen-limitation justifications (pgvector/jsonb) — documented debt, not flagged.
- **`repo-result.ts` / PGRST116 empty-vs-broken design** is sound and consistently used; `maybeSingle` vs `single` choices match the documented idempotency intent.
- **`name-resolution.ts` id→id error fallback** is deliberate and documented (never a silently empty map).
- **LLM id allowlisting before mutations** is present at all five call sites, including the out-of-range-index guard at `task-extractor.ts:1015`.
- **Date/timezone core** (`getZonedDate`, `buildISODate` round-trip validation, `inferYear`, midnight-UTC storage) is correct; the only date defects are the boundary issues in EXTR-1.
- **LCS prefilters** are mathematically sound, with a dedicated test seam asserting prefilter/brute-force equivalence.

---

## Obsidian Plugin — `obsidian-plugin/`

(No skipped tests, no `catch {}`, no `@ts-nocheck`/`eslint-disable` found; the key is sent via `x-tb-key` header and legacy `?key=` URLs are migrated out.)

### PLUG-1 — Medium — SyncEngine has no in-flight guard; overlapping `processNote` runs can interleave, and a failed in-flight sync resurrects a timer after unload

**Files:** `obsidian-plugin/src/syncEngine.ts:65-86` (scheduleSync), `:208-262` (processNote), `obsidian-plugin/src/main.ts:60-65` (onunload), `:150-155`, `:188-193`

The poller has a `pollInProgress` guard (aiOutputPoller.ts:27,33), but the sync engine has none. (1) A debounce timer fires, deletes itself from `debounceTimers`, and awaits `ingestNote`. While that await is pending, the user triggers the manual sync command or "Sync entire vault" for the same file — `cancelTimer` only clears *unfired* timers, so two concurrent `processNote` calls for the same note run, producing two network ingests and two `hashes.persist()` calls; a double-click on the ribbon item does the same. (2) Unload-mid-run: `onunload` calls `engine.clearAllTimers()`, but an already-fired timer whose `processNote` is still awaiting the network continues; if it resolves `"failed"` it calls `this.scheduleSync(file, attempt + 1)`, inserting a *new* timer into the just-cleared map. That timer survives plugin disable and fires a network call + Notice up to 30 minutes later from a dead plugin.

**Fix:**
1. In `SyncEngine`, add `private inFlight = new Map<string, Promise<SyncOutcome>>()`. At the top of `processNote`, if `inFlight.has(file.path)`, return the existing promise (or await it and return `"skipped"`); store the promise before the first await and delete it in a `finally`.
2. Add `private unloaded = false;` set in `clearAllTimers()` (or add a `dispose()`). In the timer callback and the retry branches, bail out (`if (this.unloaded) return;`) before calling `scheduleSync` again.
3. Tests (syncEngine.test.ts): (a) start a `processNote` whose `ingest` is gated on an unresolved promise, call `processNote` again for the same path, resolve, assert `ingest` was called once; (b) using the `captureTimers` harness, fire a failing sync, call `clearAllTimers()` while the ingest promise is pending, then resolve — assert no new timer was captured.

### PLUG-2 — Medium — `request()` trusts the JSON envelope without validating it (property access on `any`)

**File:** `obsidian-plugin/src/apiClient.ts:123-127`

`const result = await response.json()` yields `any`, so `result.success` and `result.error || …` are unvalidated property accesses on external data, and the `Promise<Record<string, unknown>>` return annotation is an implicit cast. A 200 response whose body is `null`, a bare string, or a number throws a `TypeError` far from the boundary; a 200 response with a non-JSON body (proxy/captive-portal HTML) rejects with a raw `SyntaxError` that surfaces verbatim in a Notice. The file's own header comment ("External data is validated here — never cast with `as`") documents the intent the envelope path doesn't meet.

**Fix:**
1. Wrap `response.json()` in try/catch and rethrow `new Error(\`${errorLabel}: server returned non-JSON response\`)`.
2. Validate the parsed value with the existing `isRecord` guard (apiClient.ts:31-33); throw `Malformed response envelope` if it fails. Then check `result.success !== true`, and only use `result.error` when `typeof result.error === "string"`.
3. Tests in apiClient.test.ts: `json: async () => null`, `json: async () => "oops"`, and a throwing `json` — each must reject with the friendly message, not a TypeError/SyntaxError.

### PLUG-3 — Medium — `(error as Error).message` casts on caught unknowns; a non-`Error` throw crashes *inside the catch handler*, producing an unhandled rejection from the poll interval; plus 5 duplicated copies of error-message formatting

**Files:** `obsidian-plugin/src/aiOutputPoller.ts:60`, `:124`; `obsidian-plugin/src/syncEngine.ts:258`; safe variant duplicated at `syncEngine.ts:131-133` and `:152-155`; consumers `obsidian-plugin/src/main.ts:207`, `:241`

Three catch sites cast `error as Error` and pass `.message` to `truncateForNotice`. If anything throws a non-`Error` (a string, or a rejected promise with a plain object), `.message` is `undefined` and `truncateForNotice(undefined)` throws **inside the catch block**. In `pollAIOutput` that escapes the try/catch and rejects the promise; the interval callback (main.ts:241) and startup timeout (main.ts:207) don't handle rejections, so it becomes an unhandled rejection and the user sees nothing — a poll failure silently swallowed. Separately, the *correct* pattern `error instanceof Error ? error.message : String(error)` already exists twice in syncEngine.ts; with the three cast sites that's five occurrences — past the Rule of Three.

**Fix:**
1. Add `export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }` to `utils.ts`.
2. Replace all five sites with `truncateForNotice(errorMessage(error))`.
3. Unit tests: `errorMessage("boom")`, `errorMessage({})`, `errorMessage(new Error("x"))`; plus a poller test where `metadataImpl` rejects with a **string** on a manual pull — must show a Notice, not throw.

### PLUG-4 — Medium — Settings validated for type but not range: a 0/negative/NaN minute value from disk becomes a 0 ms `setInterval`/debounce

**Files:** `obsidian-plugin/src/settings.ts:56-57`, `:64-71`; consumed at `main.ts:241` and `syncEngine.ts:90`

`mergeAndMigrateSettings` accepts any `number` for `syncDelayMinutes`/`pollIntervalMinutes` — including `0`, negatives, and `NaN`. The settings UI enforces `>= 1`, but the boundary parse does not, so a hand-edited or corrupted `data.json` flows straight into `window.setInterval(…, 0)` — a poll fired every event-loop tick, hammering the MCP server with authenticated requests — and into a 0 ms debounce that syncs on every keystroke. The UI-side minimum is not boundary validation.

**Fix:**
1. In `mergeAndMigrateSettings`, clamp both fields: `Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT…` (apply to both, including the legacy-ms migration results at lines 64-71).
2. Tests in settings.test.ts: `{ syncDelayMinutes: 0 }`, `{ pollIntervalMinutes: -5 }`, `{ pollIntervalMinutes: NaN }` all yield the defaults.

### PLUG-5 — Medium — Safety tooling gaps: no ESLint at all, `noUncheckedIndexedAccess` off, `-skipLibCheck` in the build, test files excluded from typechecking

**Files:** `obsidian-plugin/tsconfig.json:11-22`, `obsidian-plugin/package.json:6-20`

The directive requires `strict`, `noUncheckedIndexedAccess`, `no-floating-promises`, and `no-explicit-any` ON. `strict` is on, but: (1) there is no ESLint config or dependency anywhere in the package, so `no-floating-promises` and `no-explicit-any` are unenforced — concretely, the unhandled-rejection paths in PLUG-3, the liberal `any` in `test/obsidian-stub.ts:59-97`, and the unused `beforeEach` import in `aiOutputPoller.test.ts:1` would all have been caught; (2) `noUncheckedIndexedAccess` is missing; (3) the build script runs `tsc -noEmit -skipLibCheck`; (4) `"exclude": ["src/**/*.test.ts"]` means no command ever typechecks the test files, so casts like `0 as unknown as ReturnType<typeof setTimeout>` accumulate unchecked.

**Fix:**
1. Add `"noUncheckedIndexedAccess": true` and fix fallout (e.g. `utils.ts:129` `split(":")[0]` needs a guard or `?? ""`).
2. Add `eslint` + `typescript-eslint` with `@typescript-eslint/no-floating-promises` and `no-explicit-any` as errors; add a `lint` script and wire it into `build`.
3. Add a `tsconfig.test.json` (or a second `tsc -noEmit -p …` step) that typechecks the test files.
4. Remove `-skipLibCheck` from the build script if the `obsidian` typings allow; if not, keep it with an inline justification.

### PLUG-6 — Medium — Access key is still attached to cleartext `http://` requests; the insecure-endpoint warning is passive (settings tab only)

**Files:** `obsidian-plugin/src/apiClient.ts:89-96` (buildRequestHeaders), `:104-121`; `settings.ts:156-167`; `utils.ts:123-131`

The directive is "HTTPS verified before credentials are sent." `isInsecureEndpoint()` exists and the settings tab shows a red warning for non-local `http://`, but the warning is only visible while the settings tab is open — advisory, not enforcing. `buildRequestHeaders()` attaches `x-tb-key` unconditionally, so every debounced sync, vault sync, and background poll sends the access key **and full note content** in cleartext to a non-local `http://` endpoint the moment such a URL is configured (typo of `http://` for `https://` is the realistic path). The localhost carve-out in `isInsecureEndpoint` already gives the dev-loop escape hatch, so hard enforcement costs nothing.

**Fix:**
1. In `HttpTerrestrialBrainClient.request()`, check `isInsecureEndpoint(this.settings.getEndpointUrl())`; if true, throw `new Error("Refusing to send your access key over unencrypted http://. Use https:// (or a localhost test server).")` before calling `fetch`. This surfaces through the existing error/Notice paths.
2. apiClient.test.ts: a call against `http://example.com/mcp` with a key rejects and `fetch` is never invoked; `http://localhost:54321/...` still works.

### PLUG-7 — Medium — Mutation-check failures: the poller re-entrancy guard, the modal's decision/close logic, `applyPollInterval`, and unload cleanup have zero failing tests if deleted

**Files:** `obsidian-plugin/src/aiOutputPoller.ts:27,33,63`; `confirmModal.ts:117-145`; `main.ts:60-65`, `:233-244`; evidence: `confirmModal.test.ts:24-34` (the `getResult` helper is defined and never used by any assertion)

Verified by scanning every test file: (1) deleting `if (this.pollInProgress) return;` fails no test; (2) `AIOutputConfirmModal.resolve()`, the button click handlers, and the `onClose` → postpone-when-unresolved rule are untested — confirmModal.test.ts only asserts rendered structure/CSS, so deleting the entire `resolve` body (or flipping close-without-choice from "postponed" to "rejected", which would **reject and destroy pending AI outputs on Escape**) stays green; (3) `applyPollInterval()`'s dedup and clear-before-reregister — the exact regression its own comment says it guards ("finding C10") — has no test; (4) `onunload`'s interval clear + `clearAllTimers` has no test.

**Fix:**
1. Poller test: `metadataImpl` gated on a deferred; call `pollAIOutput()` twice before resolving; assert `metadataImpl` ran once.
2. ConfirmModal tests using the existing stub: simulate the three button handlers (extend the element stub's `addEventListener` to record listeners), assert `getResult()` decisions; call `onClose()` without a prior button and assert `{ decision: "postponed" }`; call a button then `onClose()` and assert `onResult` fired exactly once.
3. main.test.ts: with the stubbed `window`, call `applyPollInterval()` twice with the same minutes → `setInterval` called once; change the minutes, call again → `clearInterval` with the old id + `setInterval` with the new period; call `onunload()` → `clearInterval` called.

### PLUG-8 — Low — Startup poll `setTimeout` is untracked and never cleared on unload

**File:** `obsidian-plugin/src/main.ts:29-30`, `:205-210`, `:60-65`

`startPolling()` fires `window.setTimeout(() => this.poller.pollAIOutput(), 2000)` without storing the id, and `onunload` only clears `pollIntervalId`. If the user disables the plugin (or Obsidian reloads it during an update) within the 2 s window, the poll still runs against the dead plugin's poller — a network request with credentials from an unloaded plugin.

**Fix:** Store the id and clear it in `onunload` (or `this.register(() => window.clearTimeout(id))`). Add the assertion to the PLUG-7 unload test.

### PLUG-9 — Low — "Sync active note" logic duplicated between the command palette and the ribbon menu

**File:** `obsidian-plugin/src/main.ts:150-155` vs `:188-193`

The 4-line block (getActiveFile → null-check + Notice → `cancelTimer` → `processNote({ force: true })`) is pasted verbatim into both entry points. The two-entry-points clause says write it once with thin adapters; a fix to one copy will silently miss the other.

**Fix:** Extract `private async syncActiveNote(): Promise<void>` on the plugin; both the command callback and the ribbon `onClick` call it. Existing main.test.ts command-capture pattern covers regression.

### PLUG-10 — Low — `isRecord` duplicated in two files, with a third inline copy in `main.ts` (Rule of Three reached)

**Files:** `obsidian-plugin/src/apiClient.ts:31-33`, `settings.ts:35-37`, `main.ts:290-293` (two inline `typeof data !== "object" || data === null` checks in `extractSyncedHashes`)

**Fix:** Move `isRecord` to `utils.ts` (already the framework-free helper module); delete the two local copies and rewrite `extractSyncedHashes` to use it. Add one direct `isRecord` unit test in utils.test.ts.

### PLUG-11 — Low — A read failure during a *forced vault sync* is reported as "skipped", conflating broken with empty

**File:** `obsidian-plugin/src/syncEngine.ts:224-231`, `:189-195`

`processNote` returns `"skipped"` on any reader error. The inline comment justifies this for the debounce path (file may have been deleted between the modify event and the read) — legitimate there. But `syncEntireVault` enumerates the file list immediately before iterating, so a read error there is almost certainly a real failure (permissions, disk error), yet it lands in the `skipped` bucket and the summary reads "✅ Vault sync complete — N synced, M skipped": broken rendered as a success footnote.

**Fix:** Return `"failed"` from the read-catch when `options.force` is set (manual/vault-sync context), keeping `"skipped"` for the unforced debounce path; or introduce a fourth outcome `"unreadable"` counted as failed. Test: vault sync over one readable + one throwing reader → `{ synced: 1, failed: 1, skipped: 0 }` and no "Vault sync complete" notice.

### PLUG-12 — Low — `stripFrontmatter` over-strips: a note opening with a horizontal rule loses content before sync

**File:** `obsidian-plugin/src/utils.ts:12-14`

`/^---[\s\S]*?---\n?/` matches from a leading `---` to the *next* `---` anywhere. A note that begins with a markdown horizontal rule and contains another `---` later has everything through the second rule silently deleted before hashing and ingest — the backend permanently receives a truncated note, and because the hash is computed on the stripped text, no re-sync ever corrects it. Obsidian frontmatter requires `---` as the entire first line and a closing `---` on its own line; the regex enforces neither.

**Fix:** Tighten to `/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/`. Add utils.test.ts cases: leading-hr note unchanged; real frontmatter still stripped; frontmatter containing `---` inside a value handled.

### PLUG-13 — Low — Timer/clock seam missing in `SyncEngine`; tests forced to monkey-patch global `setTimeout` with double casts

**Files:** `obsidian-plugin/src/syncEngine.ts:45`, `:67`, `:98`; `syncEngine.test.ts:221-228`

Every other external dependency is behind an injected port, but the engine calls global `setTimeout`/`clearTimeout` directly. The consequence is visible in the tests: `captureTimers()` must `vi.spyOn(globalThis, "setTimeout")` with two `as unknown as` casts — a global patch that would silently break any other timer user in the process.

**Fix:** Add a `Scheduler` port to `ports.ts` (`schedule(callback, delayMs): TimerHandle; cancel(handle): void`), default-wired in `main.ts`'s `buildCollaborators`; add it to `SyncEngineDeps`. Replace `captureTimers()` with a plain fake scheduler in `testSupport.ts` — no global spy, no casts. Also gives the PLUG-1 tests a clean lever.

### PLUG-14 — Low — `AIOutputConfirmModal` takes 4 positional constructor parameters; `select.value` is cast instead of parsed

**File:** `obsidian-plugin/src/confirmModal.ts:30-47`, `:112-114`

The constructor `(app, metadataList, conflicts, onResult)` hits the options-object rule. Separately, `select.value as "overwrite" | "rename"` casts DOM input; any future third option (or a browser quirk resetting value to `""`) flows an invalid resolution into the write path unchecked.

**Fix:** Change the constructor to `(app: App, options: { metadataList; conflicts; onResult })`. Replace the cast with an allowlist parse: `select.value === "rename" ? "rename" : "overwrite"`. Update the two call sites; PLUG-7's modal tests cover it.

### PLUG-15 — Low — Invalid numeric settings input is silently ignored: the field shows the rejected value while the stored setting keeps the old one

**File:** `obsidian-plugin/src/settings.ts:211-222`, `:231-244`

In both numeric settings, `onChange` drops any value that fails `parseInt`/`>= 1` with no feedback. A user typing `0`, `-3`, or `abc` sees their text sitting in the field and believes it took effect, while the plugin keeps the previous cadence. (Both handlers are also the same 8-line pattern twice; a third numeric setting would cross the Rule of Three.)

**Fix:** Extract a shared `addMinutesSetting(containerEl, { name, desc, placeholder, getValue, setValue })` helper that on invalid input shows a Notice (or inline error) like "Enter a whole number ≥ 1" and resets the text field to the stored value. Cover with a settings-tab test using the existing `TextStub` (extend it to retain the `onChange` callback).

### PLUG-16 — Low — Single-letter lambda parameters throughout the test files

**Files:** `syncEngine.test.ts:39` (`(c, t, n) => ingest(c, t, n)`), `:98,108,109,119,120,127` (`(m) =>`); `aiOutputPoller.test.ts:81,82,122,133,198` (`(c) =>`), `:114` (`(_c, title)`); `main.test.ts:156,157` (`(m) =>`)

The no-single-letter rule applies to all code, tests included (production `src/` files comply). Rename to `(content, title, noteId)`, `(message)`, `(callEntry)` etc. Mechanical; the ESLint setup from PLUG-5 prevents recurrence.

### Plugin — explicitly checked and passed

- Background-poll failures staying silent (aiOutputPoller.ts:58-61) — explicit design comment; manual pulls do notify.
- `simpleHash`'s 32-bit collision window (utils.ts:56-62) — documented trade-off with bounded consequence.
- Plaintext key storage in plugin data — disclosed in the setting description (settings.ts:173-175).
- String-based URL parsing in `extractKeyFromUrl` (utils.ts:94-96) — documented partial-URL-while-typing rationale.
- `main.test.ts`'s claim of running "through the real engine + client" is accurate — only `fetch` (the true boundary) is stubbed.

---

## Database, Scripts & Config — `supabase/`, `scripts/`, `deno.json`, CI

(No Critical findings; the overall security posture — RLS everywhere, blanket grant/revoke hardening in `20260704000001`, per-RPC explicit grants — is solid. All migration fixes below are NEW migration files, preserving append-only discipline.)

### SQL-1 — Medium — `function_call_logs` RLS policy missing `to service_role` clause (the exact past-bug shape)

**Files:** `supabase/migrations/20260404000002_function_call_logs.sql:16-18`; canonical shape in `supabase/migrations/20260704000001_fix_db_security_policies.sql:17-24`

The policy is `create policy "Service role full access" on function_call_logs for all using (auth.role() = 'service_role');` — no `to` clause, so it attaches to ALL roles and relies solely on the row-predicate. This is the same structural defect class as the `people` policy that leaked personal data (S1), which `20260704000001` fixed for `people` but did not normalize here. Today it is not exploitable (the predicate returns false for anon, and table DML was revoked) — but the defense is one grant-drift away from the historical bug, `auth.role()` is deprecated by Supabase, the predicate is evaluated per row (slow on a log table), and `function_call_logs` holds personal data (serialized tool inputs containing note content, plus `ip_address`).

**Fix (new migration):**
1. `drop policy "Service role full access" on public.function_call_logs;`
2. Recreate in the canonical shape: `create policy "Service role full access on function_call_logs" on public.function_call_logs for all to service_role using (true) with check (true);`
3. Add a pgTAP assertion (see SQL-5) that every policy in `pg_policies` for schema `public` has `roles = '{service_role}'`, so a policy can never again ship without a `to` clause.

### SQL-2 — Medium — No index on `thoughts.content_hash`, but the sync dedup gate queries it on every capture

**Files:** `supabase/migrations/20260712000001_memory_hygiene.sql:10-13,29-30` (adds the column, indexes `superseded_by`/`last_retrieved_at` but not `content_hash`); caller `repositories/supabase-thought-repository.ts:159-168` (`findByContentHash`)

The INVARIANT-1 dedup gate does an equality lookup on `content_hash` for every incoming capture/sync. With no index this is a sequential scan of the entire `thoughts` table (the largest personal-data table, which only grows) on the hot write path. As the vault grows to tens of thousands of thoughts, capture latency climbs and the dedup gate becomes the bottleneck of the one server-side update path.

**Fix (new migration):**
```sql
-- Partial index for the sync dedup gate (findByContentHash): equality on
-- content_hash over active, non-superseded rows only.
create index if not exists idx_thoughts_content_hash
  on public.thoughts (content_hash)
  where content_hash is not null
    and archived_at is null
    and superseded_by is null;
```
Only `thoughts` needs this — `projects`/`tasks`/`documents` stamp `content_hash` but no code path filters on it; do not add speculative indexes. (Note: if TOOL-7's partial **unique** index lands in Step 5, that index also serves this lookup — coordinate the two migrations.)

### SQL-3 — Medium — `get_pending_ai_output_metadata` is unbounded; the only cap is PostgREST's silent 1000-row truncation

**Files:** `supabase/migrations/20260323000002_ai_output_metadata_function.sql:13-24` (no `LIMIT`); `supabase/config.toml:18` (`max_rows = 1000`); caller `repositories/supabase-ai-output-repository.ts:41`

The RPC returns every pending row with no `LIMIT` and no limit parameter. The only bound is the PostgREST `max_rows = 1000` cap, which truncates *silently*: if pending output exceeds 1000 rows (e.g. the plugin stops polling for a while), the oldest 1000 are returned with no signal that more exist, so newer pending items appear to vanish from the poll.

**Fix (new migration):**
1. Re-create with a bounded signature (adding a parameter changes the signature — drop the old one first): `drop function if exists public.get_pending_ai_output_metadata();` then `create or replace function public.get_pending_ai_output_metadata(max_rows integer default 200) … limit greatest(max_rows, 1)`, plus the explicit `revoke … from public, anon, authenticated; grant execute … to service_role;` restated.
2. In the edge repository, pass the limit explicitly and log when exactly `max_rows` rows come back (possible truncation), per the "cap is explicit and logged" rule.

### SQL-4 — Low — SECURITY DEFINER functions pin `search_path` without `pg_temp`; trigger function pins nothing

**Files:** `supabase/migrations/20260404000001_thoughts_usefulness_score.sql:12-13` (`increment_usefulness`); `supabase/migrations/20260712000001_memory_hygiene.sql:82-84` (`increment_usefulness_weighted`); correct pattern in `supabase/migrations/20260706000002_function_call_logs_retention.sql:40` (`set search_path = public, pg_temp`); `supabase/migrations/00000000000000_initial.sql:20-26` (`update_updated_at` sets no `search_path` at all — Supabase linter 0011)

When `search_path` is set without `pg_temp`, PostgreSQL implicitly searches the session's temporary schema *first*: a caller who can create a temp table named `thoughts` could have the definer's `UPDATE` resolve to their temp table. Practical exploitability is low (EXECUTE is service_role-only), but the repo already uses the hardened form in the retention migration — the two increment RPCs are drift from the project's own convention.

**Fix (new migration):** `create or replace` `increment_usefulness(uuid[])`, `increment_usefulness_weighted(uuid[], int)` (bodies unchanged) and `update_updated_at()` with `set search_path = public, pg_temp`; restate the explicit revoke/grant lines for the two RPCs; update any `supabase/schemas/` mirror files.

### SQL-5 — Medium — pgTAP suite contains zero DENIAL tests; every test runs as superuser happy-path

**Files:** all of `supabase/tests/ai_output.test.sql`, `note_snapshots.test.sql`, `projects.test.sql`, `search_thoughts_by_embedding.test.sql`, `tasks.test.sql`, `thoughts_snapshot_fk.test.sql`

All six pgTAP files test constraints, defaults, FKs, and RPC behavior connected as the migration superuser. Not one does `SET LOCAL ROLE anon` / `authenticated` and asserts denial — despite (a) the binding rule that access-control changes require denial tests, and (b) the project's actual shipped bug being precisely an RLS policy that silently granted anon full access to `people`. A future migration that recreates a policy without its `to` clause, or a new table without the revoke, goes red nowhere.

**Fix (new test file `supabase/tests/rls_denial.test.sql`):**
1. For each table (`thoughts`, `projects`, `tasks`, `note_snapshots`, `ai_output`, `people`, `documents`, `function_call_logs`): `SET LOCAL ROLE anon;` then `throws_ok('SELECT …', '42501', …)` and the same for INSERT; repeat for `authenticated`; `RESET ROLE` between blocks.
2. For each RPC (`search_thoughts_by_embedding`, `thought_stats`, `increment_usefulness`, `increment_usefulness_weighted`, `purge_function_call_logs`, `get_pending_ai_output_metadata`, `normalize_thought_project_refs`): assert EXECUTE is denied to anon/authenticated.
3. Add a meta-assertion that every row in `pg_policies` for schema `public` has `roles = '{service_role}'` (catches the missing-`to` class generically).
4. Wire the suite into the pipeline (SQL-6) so these actually run.

### SQL-6 — Medium — pgTAP tests are not executed by any pipeline (`supabase test db` absent from validate-all.sh and CI)

**Files:** `scripts/validate-all.sh:16-29`; `.github/workflows/ci.yml:39-61`; evidence the suite is manual-only: `openspec/changes/archive/ai-output-confirmation-dialog/tasks.md:35`

Six pgTAP files exist and once passed, but neither `validate-all.sh` nor CI invokes `supabase test db`. The DB-level regression net can rot silently: a migration that breaks the `ai_output_pending_idx` shape or `search_thoughts_by_embedding` threshold semantics lands with green `npm run validate` and green CI.

**Fix (script edits):**
1. In `scripts/validate-all.sh`, after the stack-reachability check, add `(cd "$REPO_ROOT" && npx supabase test db)` with its own step header; `set -euo pipefail` already aborts on failure.
2. In `.github/workflows/ci.yml`, add a `pgTAP database tests` step between "Start Supabase stack" and the Deno tests.
3. Verify once locally that the current PG17 image runs pgTAP (memory notes flag PG17 image quirks); if the container lacks pg_prove, pin a CLI version in CI that supports it.

### SQL-7 — Low — pg_cron scheduling failure is swallowed in production too; nothing verifies the GDPR purge job exists

**Files:** `supabase/migrations/20260706000002_function_call_logs_retention.sql:62-73`; `scripts/initial-setup-prod.sh:100-110`; `scripts/deploy-update-prod.sh:113-116`

The `DO` block wrapping `cron.schedule` catches *all* exceptions so local/CI migrations succeed without pg_cron (justified by the nearby comment) — but the same handler swallows a *production* scheduling failure, emitting only a NOTICE inside `supabase db push` output. If that happens, the 90-day retention purge of `function_call_logs` — the table holding note content and IP addresses — silently never runs, and nothing ever checks that the job exists. A GDPR retention control failing open with no signal.

**Fix:**
1. Add to `initial-setup-prod.sh` Step 5 and `deploy-update-prod.sh` Step 4 a verification query against the linked DB: `select jobname from cron.job where jobname = 'purge-function-call-logs-daily';` — print a loud `WARNING: retention purge job is NOT scheduled` and exit non-zero if absent in production.
2. Optionally, in a new migration, narrow the exception handler to the specific SQLSTATEs seen locally (`undefined_file`, `feature_not_supported`, `undefined_schema`) so an unexpected production error fails the push instead of hiding.

### SQL-8 — Low — `increment_usefulness_weighted` accepts unbounded/negative `weight` with no validation

**File:** `supabase/migrations/20260712000001_memory_hygiene.sql:80-95`

The RPC applies `usefulness_score + weight` for any integer — negative, zero, or `2147483647` — with no CHECK. Service_role-only, so not an access hole, but the DB is the last boundary before a persistent mutation: a single edge-function bug (or an LLM-derived value flowing into the weight) could corrupt every targeted thought's ranking signal in one call, or overflow `integer` mid-batch. `increment_usefulness` avoids this class by hardcoding `+1`.

**Fix (new migration):** `create or replace` the function with a guard at the top: `if weight < 1 or weight > 100 then raise exception 'weight must be between 1 and 100, got %', weight; end if;` (pick the cap from the edge function's actual weighting scheme), with `set search_path = public, pg_temp` per SQL-4; restate the revoke/grant lines.

### SQL-9 — Low — Archived personal-data rows are retained forever; no retention sweep parallels the function_call_logs one

**Files:** `supabase/migrations/20260404000004_thoughts_archived_at.sql:2`; `supabase/migrations/20260324000001_people.sql:9` (people soft-delete incl. `email`); contrast `supabase/migrations/20260706000002_function_call_logs_retention.sql` (the only retention job in the schema)

The MCP surface exposes only archival — `archived_at` is stamped and rows persist indefinitely, including third-party personal data (`people.name`, `people.email`, thought content about named people). Hard deletion *is* possible at the DB level (service_role DELETE; FKs are `set null`/`cascade`, verified in the pgTAP tests), but there is no defined erasure/retention pathway for archived rows — in tension with GDPR storage-limitation. A data-subject erasure request for a person mentioned in archived thoughts has no supported pathway.

**Fix (policy decision + new migration):**
1. Decide (with the user) a retention window for archived rows, or an explicit "retain until manual erasure" policy documented in `ThreatModel.md` / GDPR docs.
2. If a window is chosen: new migration adding `purge_archived_rows(retention_days integer default N)` (same shape as `purge_function_call_logs`: `search_path = public, pg_temp`, count returned, service_role-only EXECUTE), plus a best-effort `cron.schedule` guarded as in `20260706000002` (with the SQL-7 verification).
3. Independent of the window: document the manual erasure runbook (service_role DELETE by person/thought id) so an erasure request has a named pathway.

### SCRIPT-1 — Medium — Production secrets passed as process arguments (visible in `/proc/*/cmdline` on a shared machine)

**File:** `scripts/initial-setup-prod.sh:85-90`

The script correctly reads `OPENROUTER_API_KEY` and `MCP_ACCESS_KEY` with `read -rsp`, but then execs `npx supabase secrets set "OPENROUTER_API_KEY=…" "MCP_ACCESS_KEY=…"` — putting both secrets into argv, world-readable via `ps` / `/proc/<pid>/cmdline` for the lifetime of the (network-bound, potentially slow) CLI call. The project's own operating assumption is a shared machine with other agents running concurrently.

**Fix:**
1. Use the CLI's env-file form: write the pairs to a `mktemp` file created under `umask 077`, `npx supabase secrets set --env-file "$SECRETS_FILE" --project-ref "$PROJECT_REF"`, then remove it.
2. Put the `rm -f "$SECRETS_FILE"` in a `trap … EXIT` so an interrupted run never leaves the file behind.
3. Update the two echoed hints (`initial-setup-prod.sh:96`, `deploy-update-prod.sh:110`) that teach the argv form.

### SCRIPT-2 — Medium — No port-offset support; all service ports hardcoded to Supabase defaults, and validate-all.sh hardcodes 54321

**Files:** `supabase/config.toml:10,29,31,41,91,101,364,373`; `scripts/validate-all.sh:11` (`http://localhost:54321` literal); `scripts/dev.sh` (no offset mechanism)

The binding rule: anything using a port must take a port offset into account because the machine is shared. Every port is the stock Supabase default, so any other Supabase project with defaults collides — `supabase start` fails or, worse, `validate-all.sh`'s reachability probe on :54321 succeeds against a *different project's stack* and runs the suite against the wrong database. `config.toml` does not support env substitution for integer ports, so a runtime offset isn't directly expressible.

**Fix:**
1. Assign this project a unique, non-default port block in `config.toml` (e.g. api 55421, db 55422, shadow 55420, studio 55423, inbucket 55424, analytics 55427, inspector 55483).
2. In `validate-all.sh`, derive the URL from the running stack (`npx supabase status --output json | jq -r '.API_URL'`) or read the port from `config.toml` — the probe then fails correctly instead of matching a stranger's stack.
3. Grep for `54321` outside `config.toml` after the change and update docs/tests in the same branch.

### SCRIPT-3 — Low — `dev.sh` does not reset/seed the database; dirty-stack state is a documented source of test artifacts

**Files:** `scripts/dev.sh:37-38` (plain `supabase start`, no reset); `scripts/validate-all.sh:10-17` (assumes a running stack, never resets before `deno task test`)

The rule is "databases start from a blank slate and get seeded via seed scripts," and the repo's own memory notes record that skipping `supabase db reset` between backend runs produces dedup-collision failures and cold-start 504 artifacts. `validate-all.sh` runs against whatever state the previous session left, making "validate passes" partly a function of leftover data.

**Fix:**
1. In `validate-all.sh`, after the reachability check and before `deno task test`, run `npx supabase db reset` (applies migrations + `seed.sql`). Keep the tree stable during the run per the hot-reload memory note.
2. In `dev.sh`, add the same reset behind an opt-out (`TB_DEV_KEEP_DATA=1` skips it) if preserving a long-lived local vault DB matters; default should match the blank-slate rule.

### SCRIPT-4 — Low — Inconsistent CLI invocation: `dev.sh` uses bare `supabase`, everything else uses `npx supabase`

**Files:** `scripts/dev.sh:27,38,43`; `deno.json:10` (`gen:types` task); contrast the prod scripts and validate-all.sh

On a machine without a global Supabase CLI, `deno task dev` fails at `supabase start` while the prod scripts work — and a *different globally installed CLI version* can apply migrations or generate `database.types.ts` with divergent behavior (the memory notes already record CLI/PG17-image behavior differences).

**Fix:** Change `dev.sh` and the `gen:types` task to `npx supabase …`; optionally pin the CLI version and replace `version: latest` in CI (`.github/workflows/ci.yml:24-27`) with the same pin so local and CI can't drift.

### SCRIPT-5 — Low — CI comment claims the backend test step is red-by-design, but Step 7 has landed

**Files:** `.github/workflows/ci.yml:42-56`; evidence Step 7 shipped: `supabase/migrations/20260712000001_memory_hygiene.sql:1-4`; no `PENDING(step7…)` markers remain under `tests/` (verified by grep)

The workflow comment states the lifecycle tier "fail[s] on purpose … Step 7 turns them green," and lint/format carry `if: always()` "so signal survives the intentional red above." Step 7 *is* shipped, so the comment is stale documentation that actively normalizes a red required job — the exact rationalization the testing rules forbid.

**Fix:**
1. Run `deno task test` against a freshly reset stack to confirm green (if not green, that is a BLOCKED condition to surface, not a comment fix).
2. Delete the stale comment block and replace with a one-liner noting the eval/sync-rules tiers stay out of CI (still accurate).
3. Keep `if: always()` on lint/format only for genuine-failure signal — remove the "intentional red" justification text.

### SCRIPT-6 — Low — `"lock": false` in deno.json disables dependency integrity pinning

**File:** `deno.json:41`

With the lockfile disabled, every `deno task test` / CI run re-resolves `npm:`/`jsr:` specifiers without integrity hashes. Versions are exact-pinned in the import map (good), so drift risk is limited to transitive dependencies and registry-side tampering — but that is precisely what a lockfile's integrity hashes defend against, and CI currently has no supply-chain verification for the code that holds the service-role key at runtime.

**Fix:**
1. Remove `"lock": false`, run `deno install` to generate `deno.lock`, and commit it.
2. If the setting was added to dodge a specific lockfile conflict with the edge-runtime import map (`supabase/config.toml:393`), scope the fix (regenerate the lock after import-map changes) and record the reason next to the setting if it truly must stay off.

---

## Test Suite — `tests/`

(`deno task test` runs `tests/unit/` + `tests/integration/` with `TB_AI_PROVIDER=fake`; `tests/eval/` and `tests/live/` are opt-in tasks; `tests/sync-rules/` excluded per its documented PENDING status. Verified against source: the Step-7 capabilities — `reconcile_tasks`, `get_archival_queue`, `superseded_by`, allowlist coercion — have shipped, so the lifecycle suite is green today.)

### TEST-1 — High — Archival scenarios are tool-existence probes; manifest claims behavior coverage that doesn't exist

**Files:** `tests/integration/lifecycle/archival.test.ts:14-45`; manifest entries `tests/lifecycle-coverage.manifest.ts:261-290`

All three archival tests ("the archival conjunction gates the queue", "a synced-note-owned thought is never auto-queued", "archiving a queued item is a consented state transition") assert only `await hasTool("get_archival_queue")`. These were red-by-design probes written before Step 7; now that the tool is registered they pass — but the manifest marks all three `milestone: "shipped", expectation: "pass-now"`, claiming the multi-signal conjunction, the synced-note exclusion, and the consent gate are verified. Failure scenario: replace `get_archival_queue`'s body with `return textResult("")`, or make it queue *every* thought, or auto-archive without consent — the suite stays green while user memory can be silently auto-archived. Fails GATE 2b outright.

**Fix:**
1. Seed via service-role REST a thought satisfying the full conjunction (old `created_at`, `usefulness_score = 0`, null `last_retrieved_at`, null `note_snapshot_id`) and near-miss thoughts each violating exactly one signal; assert the queue contains only the first.
2. Seed a conjunction-satisfying thought with a live `note_snapshot_id` and assert it is absent.
3. Call the consented archive path on a queued item and assert `archived_at` is stamped; assert an unconfirmed/declined item's `archived_at` stays null.
4. Use the existing `lifecycleMarker`/`deleteThoughtsByMarker` helpers with try/finally. Keep the `hasTool` probe as a precondition line, not the whole test.

### TEST-2 — High — Task-reconciliation scenarios likewise assert only tool registration

**Files:** `tests/integration/lifecycle/task_reconciliation.test.ts:14-33`; manifest `tests/lifecycle-coverage.manifest.ts:292-311`

"reconciliation: the sweep asks before closing" and "reconciliation: declining leaves the task open" both assert only `hasTool("reconcile_tasks")`. Failure scenario: `reconcile_tasks` could **auto-close tasks without asking** — the exact consent violation the spec exists to forbid — and no test fails. The highest-risk consent invariant in the memory-lifecycle spec has zero behavioral coverage.

**Fix:** Create a task plus a thought that makes it look done (deterministic under `TB_AI_PROVIDER=fake`); call `reconcile_tasks` and assert (a) the response is a proposal (contains the confirm-to-close prompt), and (b) the task row's `status` is still `open` after the sweep alone. Then exercise the decline path and assert `status` remains `open` and no `archived_at` was stamped.

### TEST-3 — Medium — Two more lifecycle scenarios covered only by `columnExists` probes

**Files:** `tests/integration/lifecycle/dedup_gate.test.ts:72-80`; `tests/integration/lifecycle/supersession.test.ts:98-103`; manifest `:83-93, 179-187`

"Cross-context near-duplicate is preserved as a supersession candidate, not silently dropped" asserts only `columnExists("thoughts", "superseded_by")`. "Recording a supersession re-embeds the surviving content" asserts only `columnExists("thoughts", "content_hash")` — no test anywhere records a supersession and asserts the survivor was re-embedded/re-hashed (invariant1 tests cover `update_thought`, not `resolve_supersession`).

**Fix:** For dedup: capture two cross-context near-dups validated with `assertInDedupBand` (`_embedding.ts`), then assert both rows exist and the second carries the supersession-candidate marker. For supersession: run a content-mutating resolve and assert `content_hash` equals sha256 of the surviving content and the survivor is findable by its post-resolve wording via `search_thoughts` (move the `sha256Hex` helper from `invariant1_reembed_rehash.test.ts:22-30` into a shared lifecycle helper).

### TEST-4 — Medium — Stale "red-by-design"/PENDING titles and comments on now-passing tests

**Files:** `tests/integration/lifecycle/extraction_type_allowlist.test.ts:6-7, 27-33, 54-60` (titles still wrapped in `pendingName(…, "step7", "type-allowlist")`); stale file-header comments claiming the capability "does not exist yet": `dedup_gate.test.ts:3-6`, `task_reconciliation.test.ts:3-6`, `archival.test.ts:3-6`

The allowlist coercion shipped (`helpers.ts:20-31`), so the two `pendingName`-titled tests pass while their names still advertise they are expected to fail. The `_pending.ts` design exists precisely so failures are legible; it's now inverted: a *real regression* in the coercion would print `[PENDING(step7:type-allowlist)]` and be read as expected-red noise.

**Fix:** Remove the `pendingName(…)`/`pending(…)` wrappers from all now-green tests and rewrite the file-header comments to describe shipped behavior. Grep `tests/integration/` for `pendingName(` and `Red-by-design` and clear every hit that is now green (leave `_pending.ts` itself for sync-rules use).

### TEST-5 — Medium — Coverage manifest's "machine-checked guarantee" never checks `testRef`

**Files:** `tests/unit/lifecycle-coverage.test.ts:70-131`; `tests/lifecycle-coverage.manifest.ts:17-26`

The bijection test validates spec-heading ↔ manifest-entry names and tag/tier/milestone consistency, but never touches `testRef`: it doesn't check the referenced file exists, let alone that it contains a test exercising the scenario. That's how TEST-1/2/3 happened. A testRef pointing at a deleted or renamed file keeps the manifest green forever.

**Fix:** Add a test that for every entry with `expectation: "pass-now"`: (a) `Deno.stat` of the testRef succeeds, and (b) the file text contains at least one `Deno.test(` whose name shares a stable keyword with the scenario — add an explicit `testNameContains` field to `CoverageEntry` to make this deterministic. This won't prove behavioral depth (that's TEST-1..3), but it kills dead references and forces per-scenario anchoring.

### TEST-6 — Medium — "User and sync edits do not reinforce usefulness" tests neither a user edit nor a sync edit

**Files:** `tests/integration/lifecycle/usefulness_reinforcement.test.ts:41-59`; manifest `:219-228`

The test named "a user content edit does not reinforce usefulness" calls `update_thought` with **no `actor` argument** — which, per the suite's own `actor_model.test.ts:78-91`, records actor `LLM` by default. A regression where `actor: "user"` or `actor: "sync"` edits take a different code path that bumps `usefulness_score` would pass.

**Fix:** Pass `actor: "user"` in the existing test (matching its name), and add a sibling assertion with `actor: "sync"`, both asserting score-before == score-after.

### TEST-7 — Medium — Silent-pass branch in `get_document` error test (hidden skip / mutation gap)

**File:** `tests/integration/documents.test.ts:132-141`

The test calls `get_document` with a nonexistent id inside a try whose catch does the only assertion; if the tool wrongly returns a success result, the try completes and the test **passes with zero assertions executed** — the comment even admits the unasserted case. "Returns garbage successfully" is indistinguishable from "correctly errors".

**Fix:** Use `callToolRaw` (already exported from `tests/helpers/mcp-client.ts:90`) and assert deterministically: either `isError === true` with "No document found" in the text, or — if not-found is a non-error convention like `input_validation.test.ts:89-103` — assert `isError === false` **and** the exact not-found text. One branch, always asserted.

### TEST-8 — Medium — Anon-key denial coverage stops at `people` while claiming "ALL brain data"

**File:** `tests/integration/db_access_control.test.ts:3-11, 83-357`

The header states RLS exists "to lock the anon (publishable) key out of ALL brain data", but denial tests cover only the `people` table plus the `increment_usefulness` RPC (and `thought_stats` in `input_validation.test.ts:211-242`). `thoughts`, `tasks`, `projects`, `documents`, `note_snapshots`, `ai_output`, and `function_call_logs` have zero anon-denial tests. A future migration re-granting DML or adding a permissive policy on `thoughts` (the most sensitive table) fails nothing.

**Fix:** Extract the four denial assertions into a parameterized helper (`assertAnonDenied(table, seedRow)`) and loop it over every brain-data table; add one anon-denial probe per RPC exposed in the schema (enumerate via a service-role query on `pg_proc`/information_schema so new RPCs can't ship untested). (Coordinates with SQL-5's pgTAP suite — implement together in Step 10.)

### TEST-9 — Medium — Order-dependent module-level fixture IDs and cleanup-as-final-test

**Files:** `tests/integration/documents.test.ts:20, 22-41, 124, 638, 699-758`; `tests/integration/ai_output_http.test.ts:13-25, 128-139`; `tests/integration/ai_output.test.ts:14, 122, 182, 222, 511`; `tests/integration/thoughts.test.ts:1046-1062`

`testDocumentId` / `httpTestOutputId` etc. are assigned inside one `Deno.test` and consumed by later tests; `thoughts.test.ts:1046` explicitly reads "The thought archived in the previous test should appear…". Cleanup is itself a trailing `Deno.test` in 8+ files. (a) Running any subset via `--filter` throws on `undefined` ids or skips cleanup entirely, leaving rows that cause next-run collisions (the known dirty-stack artifact); (b) a failure in the creator test cascades misleading failures through every dependent test. The newer files (`tasks.test.ts:9-13`, `projects.test.ts:9-13`, `input_validation.test.ts:11-12`) already follow the correct self-contained try/finally pattern — the old files were never migrated.

**Fix:** Refactor `documents.test.ts`, `ai_output.test.ts`, `ai_output_http.test.ts`, and the archive-section of `thoughts.test.ts` to the self-owned-fixture pattern: each test creates what it reads (or uses a local helper like `withNoteFixture` in `enhanced_ingest.test.ts:26-39`) and deletes in `finally`. Delete the trailing cleanup tests.

### TEST-10 — Medium — Non-unique fixture names + archive-instead-of-delete cause cross-run accumulation and dedup collisions

**Files:** `tests/integration/documents.test.ts:24, 96-99, 160-166, 587-593, 738-757`; `tests/integration/queries.test.ts:63-90, 132-142, 390-398`

Fixed names ("Integration Test Document", "Empty Test Project", …) are recreated every run, and project "cleanup" only archives, so archived duplicates accumulate; a task at `queries.test.ts:135` is created and never cleaned. This is the mechanism behind the documented dirty-stack dedup-collision flake. A second run on an un-reset stack produces duplicate-name matches and false reds — or false greens on `includes(…)` assertions matching a stale row.

**Fix:** Use the existing `uniqueName()` helper (`tests/helpers/mcp-client.ts:178`) for every created title/name in the two files; hard-delete test projects (service-role DELETE) instead of archiving; register the leaked task for cleanup.

### TEST-11 — Medium — Destructive global mutation: test marks ALL pending ai_outputs picked up

**File:** `tests/integration/ai_output_http.test.ts:263-276`

To manufacture an empty state, the test fetches every pending output — regardless of creator — and marks them all picked up. Any concurrently present pending output (another suite's fixture, or real dev data on the local stack, which the rules say must be assumed shared) is silently consumed — an unrelated suite fails far from the cause, or dev data is destroyed.

**Fix:** Don't force a global empty state. Assert the *filtered* empty condition (create → pick up → assert that specific id absent from pending, already done at lines 106-115); if a true empty-array shape test is needed, assert the response shape without requiring length 0, or scope the emptiness assertion to a marker.

### TEST-12 — Medium — Rule-of-Three duplication: inline REST auth headers, SSE parsing, and tools/list re-implemented across files

**Files (representative):** inline `apikey/Authorization` fetch blocks ~40× in `thoughts.test.ts` (e.g. 67-78, 355-376), `documents.test.ts` (61-69, 355-363), `queries.test.ts` (156-166, 306-317) despite `serviceHeaders()`/`restUrl()` existing in `tests/helpers/mcp-client.ts:144-157`; full constant re-declaration in `ingest_note_route.test.ts:8-17` and `extractors.test.ts:30-32`; SSE-parse + tools/list logic re-implemented in `documents.test.ts:660-695`, `ai_output_http.test.ts:199-228`, `ingest_note_route.test.ts:136-166` while `toolNames()` exists in `lifecycle/_tools.ts:17-39` and `parseSse` in `mcp-client.ts:71-77`

The helpers module's own header comment says files import from it "instead of re-declaring inline" — the migration was only partial. A transport change (SSE framing, auth header rename) requires touching 4+ hand-rolled copies; the missed copy silently tests the old contract.

**Fix:** Sweep `tests/integration/` replacing inline REST fetches with `restUrl()`/`serviceHeaders()`; move `toolNames()` from `lifecycle/_tools.ts` into `tests/helpers/mcp-client.ts` and use it in the three tool-list tests; delete the local constants in `ingest_note_route.test.ts`.

### TEST-13 — Medium — `ExtractionContext` literal repeated ~25 times in extractors.test.ts

**File:** `tests/integration/extractors.test.ts` (e.g. 254-267, 285-301, 313-326, 338-351, 375-388, 429-442, …)

Every test hand-builds the same 13-field context object. Adding a 14th field requires editing ~25 sites; the churn invites copy-paste divergence (some sites already differ only in `knownProjects`/`accumulatedReferences`).

**Fix:** Add `function makeExtractionContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext` at the top of the file (or a shared `tests/integration/_extraction.ts`) wiring the module-scope deps, and collapse every literal to `makeExtractionContext({ knownProjects: […] })`.

### TEST-14 — Low — Unit-style tests living inside the integration suite

**Files:** `tests/integration/extractors.test.ts:59-241` (section explicitly titled "Pipeline unit tests (mock extractors)" — fake `Extractor` objects on the pipeline↔extractor path); `tests/integration/lifecycle/extraction_type_allowlist.test.ts` (drives `extractMetadata` in-process with the unit `FakeAiProvider`; nothing touches the running stack); `tests/integration/ai_output.test.ts:262-378` (`generateTaskMarkdown` pure-function tests)

By the project's own mock-boundary rule these are unit tests: the mock-extractor pipeline tests fake the very components the "integration" would compose. They inflate integration coverage counts and run against the DB unnecessarily.

**Fix:** Move `extractors.test.ts:59-241` and `ai_output.test.ts:262-378` into `tests/unit/`, and either move `extraction_type_allowlist.test.ts` to unit or rewrite it to assert coercion through the real `capture_thought` path (DB-visible `metadata.type`).

### TEST-15 — Low — Fixed 50 ms sleep to force `updated_at` difference

**File:** `tests/integration/documents.test.ts:367-368`

`await new Promise((resolve) => setTimeout(resolve, 50));` before the title-only update, so `updated_at` differs. A fixed sleep standing in for a condition; on a slow clock-granularity path it could still collide, and it adds dead time. (The only other timing constructs in the suite are correctly bounded condition polls.)

**Fix:** Drop the sleep and assert the condition directly: poll (bounded, like `request_context.test.ts:53-61`) until `updated_at !== originalUpdatedAt`, or compare with `>` on parsed timestamps — Postgres `timestamptz` has microsecond precision, so no sleep is needed.

### TEST-16 — Low — Fixture leaks on failure paths and soft cleanup

**Files:** `tests/integration/thoughts.test.ts:895-907` (ingest cleanup deletes thoughts but not the `note_snapshots` row for `TEST_NOTE_ID`); `thoughts.test.ts:358-376` (cleanup ids registered only `if (response.ok)` — a failed lookup silently skips registration); `ingest_note_route.test.ts:25-46` (ingest with no `note_id` creates thoughts with null reference_id, never cleaned); `ai_output.test.ts:511` and `enhanced_ingest.test.ts:617-622` (ai_output rows only marked picked up — rows accumulate; the mark is conditional); `extractors.test.ts` (cleanup ids pushed only at test end — a mid-test assertion failure orphans rows)

Repeated runs on a non-reset stack accumulate rows, degrading marker queries and feeding the known dedup-collision flake; the `response.ok` guard is a mini catch-swallow converting a broken lookup into a silent leak.

**Fix:** Delete `note_snapshots` alongside thoughts in the `thoughts.test.ts` cleanup; register cleanup ids before assertions (or delete by marker in `finally` as `lifecycle/_thoughts.ts:63-70` does); hard-delete ai_output fixtures by id in `finally`; in `ingest_note_route.test.ts` pass a unique `note_id` in the fall-through test and clean it.

### TEST-17 — Low — Hardcoded absolute dates and UTC-midnight assertions in date-extraction tests

**File:** `tests/integration/extractors.test.ts:1582, 1612 ("2026-04-01"), 1866, 1898 ("2026-05-01")`

Both due-dates are already in the past relative to today. The tests pass because the parser treats absolute dates verbatim, but (a) if the parser ever gains past-date handling these rot into confusing failures, and (b) `assertEquals(new Date(task.due_by).toISOString(), "2026-04-01T00:00:00.000Z")` bakes in UTC anchoring — if storage ever becomes local-TZ-anchored, the test fails only in non-UTC environments.

**Fix:** Compute the fixture date from the clock (e.g. now + 30 days, date component) and assert `due_by.startsWith(computedDate)` rather than an exact UTC-midnight instant; pin the intended anchoring in one dedicated unit test in `tests/unit/date-parser.test.ts`.

### TEST-18 — Low — Eval tier: 2-case fixture sets under a 0.8 threshold, and a permanently-red opt-in run

**Files:** `tests/eval/memory_evals.test.ts`, `sync_evals.test.ts`, `_harness.ts:14`, `_seam.ts:10-15`

Every eval scenario has exactly 2 labeled cases with `DEFAULT_EVAL_THRESHOLD = 0.8` — pass-rates can only be 0, 0.5, or 1.0, so the documented 0.8 threshold is illusory. Also every `runCase` currently calls `evalPending(…)` which throws, so a keyed `deno task test:eval` run fails 100% by design. This is deliberate and correctly documented (fail-loud, not a skip; not in the default task) — no rule violation, but the tier delivers zero signal today even though the deterministic Step-7 capabilities it was written for have shipped.

**Fix (deferred — when Step-7 eval work is scheduled):** expand each fixture set to ≥5 labeled cases so the threshold is meaningful, and replace the `evalPending` seams for the four now-shipped capabilities with real pipeline calls. Until then no action; do not add the eval task to `deno task test`.

### TEST-19 — Low — Naming-rule violations in test code

**Files:** `tests/integration/enhanced_ingest.test.ts:663` (`(o) => o.file_path === filePath`); `tests/unit/lifecycle-coverage.test.ts:75-76` (`(k) =>`), `:99` (`(s) =>`); `tests/unit/ingest-note-steps.test.ts:135` (`insert: (t) =>`); `tests/integration/lifecycle/invariant1_reembed_rehash.test.ts:45` (helper named `del`)

Single-letter parameters violate the no-single-letter rule (only numeric loop indices are exempt); `del` is an unnecessary abbreviation. These are the only violations found in `tests/`.

**Fix:** Rename to `(output)`, `(specKey)`, `(scenario)`, `(row)`, and `deleteRows`.

### Test suite — explicitly checked and passed

- **Zero skips:** no `test.skip` / `describe.skip` / `ignore:` / env-guarded early returns anywhere in unit/integration/eval/live; the eval and live tiers throw loudly without a key instead of skipping.
- **Auth denial matrix** (`auth.test.ts`) is strong: missing/wrong/prefix/suffix/empty keys, header-over-query precedence — genuine GATE-1 denial coverage.
- **Bounded polling** in `request_context.test.ts:53-61` is the correct condition-based wait pattern; no assert-absence-after-sleep traps found.
- **Newer suites** (`tasks.test.ts`, `projects.test.ts`, `input_validation.test.ts`, `forget_note.test.ts`, `log_retention.test.ts`, `schema_cleanup.test.ts`, `open_tasks_by_project.test.ts`, `managed-ai-metering.test.ts`, `plugin_client.test.ts`, `records_returned.test.ts`) follow the self-owned-fixture/try-finally/unique-marker pattern and assert durable DB state, error channels, and empty-vs-broken distinctions correctly — they are the template the TEST-9/10/12 migrations should copy.
- **Metering/quota** integration test is a model mutation-resistant test (unique marker namespace, boundary at/over limit, handler-not-called assertion).

---

# Deliberate No-Action Items

Each area's catalog section above ends with an "explicitly checked and passed" list — patterns that were examined and found compliant or justified by nearby design comments. Do not re-flag them in future scans without new evidence. Highlights consolidated here:

- **Constant-time access-key compare** (`index.ts:209-225`) — correct; hash-then-XOR-fold, length-channel-free.
- **AsyncLocalStorage request context** — correctly removes the prior module-mutable race.
- **AI-quota fail-open on meter failure** (`ai-quota.ts:52-59`) — documented design decision D5 (the over-count/race issues in CORE-9 are separate and actionable).
- **Logged tool input containing note content** — capped at 10k chars with an explicit truncation marker; a documented data-minimization decision. SQL-7/SQL-9 cover the retention side.
- **`simpleHash` 32-bit collision window** (plugin) and **plaintext key in plugin data** — documented trade-offs, disclosed to the user.
- **Background-poll failures staying silent in the plugin** — explicit design comment; manual pulls notify. (PLUG-3's unhandled-rejection path is the actionable part.)
- **`tests/sync-rules/`** — deliberately-red PENDING v1.5 connector suite; out of scope by design.
- **TEST-18 (eval tier)** — deliberate fail-loud placeholder; act only when Step-7 eval work is scheduled.
- **Carried over from the 2026-07-04 plan's no-action list** (still accepted): string-brittle MCP text assertions; migration idempotency approach; `documents."references"` reserved-word column.

---

# Progress Checklist

## Phase A — High-severity correctness & data integrity
- [x] 1. Marker word boundaries (`bug/MarkerWordBoundaries`) — EXTR-1
- [ ] 2. Pipeline seed errors (`bug/PipelineSeedErrors`) — EXTR-2, EXTR-6
- [ ] 3. Reconciliation plan validation (`bug/ReconciliationPlanValidation`) — TOOL-1
- [ ] 4. Fake provider fidelity (`bug/FakeProviderFidelity`) — CORE-1, CORE-8, CORE-12
- [ ] 5. Dedup gate integrity (`bug/DedupGateIntegrity`) — CORE-2, TOOL-7
- [ ] 6. archive_project cascade (`bug/ArchiveProjectCascade`) — TOOL-2
- [ ] 7. OpenRouter timeout & validation (`bug/OpenRouterTimeoutValidation`) — CORE-3, CORE-4
- [ ] 8. Lifecycle test depth (`feature/LifecycleTestDepth`) — TEST-1..6

## Phase B — Security, GDPR & infrastructure
- [ ] 9. DB policy & function hardening (`bug/DbPolicyAndFunctionHardening`) — SQL-1, SQL-4, SQL-8
- [ ] 10. pgTAP denial suite + wiring (`feature/PgTapDenialSuite`) — SQL-5, SQL-6, TEST-8
- [ ] 11. Dedup indexes & hashes (`bug/DedupIndexesAndHashes`) — SQL-2, EXTR-5, EXTR-7
- [ ] 12. Bounded queries (`feature/BoundedQueries`) — SQL-3, REPO-1, TOOL-10
- [ ] 13. Prod script secrets & cron verification (`bug/ProdScriptsSecrets`) — SCRIPT-1, SQL-7
- [ ] 14. Dev stack hygiene (`feature/DevStackHygiene`) — SCRIPT-2..6
- [ ] (decision needed) Archived-rows retention policy — SQL-9 (requires a user decision on the retention window before an opsx change is scoped)

## Phase C — Error honesty & concurrency (server)
- [ ] 15. Rollback & idempotency (`bug/RollbackAndIdempotency`) — TOOL-3, REPO-5
- [ ] 16. Error surfacing sweep (`bug/ErrorSurfacingSweep`) — TOOL-4, TOOL-5, TOOL-12, TOOL-13, REPO-7
- [ ] 17. update_thought concurrency (`bug/UpdateThoughtConcurrency`) — TOOL-6
- [ ] 18. HTTP route validation (`feature/HttpRouteValidation`) — CORE-5, CORE-6, CORE-14, CORE-17, TOOL-15
- [ ] 19. Quota metering accuracy (`bug/QuotaMeteringAccuracy`) — CORE-9, CORE-10, CORE-13
- [ ] 20. Extractor enrichment & merge (`bug/ExtractorEnrichmentMerge`) — EXTR-3, EXTR-4, EXTR-8, EXTR-10

## Phase D — Obsidian plugin
- [ ] 21. Plugin sync concurrency (`bug/PluginSyncConcurrency`) — PLUG-1, PLUG-8, PLUG-13
- [ ] 22. Plugin boundary validation (`bug/PluginBoundaryValidation`) — PLUG-2, PLUG-3, PLUG-4, PLUG-6, PLUG-12
- [ ] 23. Plugin safety tooling (`feature/PluginSafetyTooling`) — PLUG-5, PLUG-7
- [ ] 24. Plugin cleanup (`feature/PluginCleanup`) — PLUG-9, PLUG-10, PLUG-11, PLUG-14, PLUG-15, PLUG-16

## Phase E — Structure, duplication & style
- [ ] 25. Deps objects (`feature/DepsObjects`) — CORE-7, TOOL-11, TOOL-14, EXTR-9, EXTR-11
- [ ] 26. Formatter dedup (`feature/FormatterDedup`) — TOOL-8, TOOL-9
- [ ] 27. Repository shape (`feature/RepositoryShape`) — REPO-2, REPO-3, REPO-4, REPO-6
- [ ] 28. Extractor structure (`feature/ExtractorStructure`) — EXTR-12, EXTR-13
- [ ] 29. Core low-severity sweep (`feature/CoreLowSweep`) — CORE-11, CORE-15, CORE-16, TOOL-16
- [ ] 30. Test suite hygiene (`feature/TestSuiteHygiene`) — TEST-7, TEST-9..17, TEST-19
