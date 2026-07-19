## Context

Phases A–D of the 2026-07-17 remediation fixed the correctness, security, and concurrency findings. Phase E (Steps 25–30) is the structure/duplication/style tranche: positional-parameter deps, drifting formatter copies, god-interface repositories, a monolithic task extractor, four small correctness cleanups (fence typing, IP telemetry, metadata-refs validation, naming), and the migration of the older integration test files to the fixture patterns the newer files already follow. The full finding detail lives in `codeEval/Fable20260717RemediationPlan.md` (CORE-7/11/15/16, TOOL-8/9/11/14/16, REPO-2/3/4/6, EXTR-9/11/12/13, TEST-7/9–17/19).

The dominant constraint: almost everything here is **behavior-preserving refactoring of code pinned by an existing green suite**. The suite is the safety net; the refactors must keep MCP tool output byte-for-byte identical except where a finding explicitly names a behavior fix.

## Goals / Non-Goals

**Goals:**
- Typed deps/options objects at every 4+-positional-parameter seam (composition root → register* → handlers → pipeline), making transposition a compile error.
- One renderer per repeated output shape (task line, thought metadata block, provenance, project-refs preamble).
- Narrow repository interfaces, one shared result-wrapping helper, schema-typed `update` payloads, typed RPC rows.
- `task-extractor.ts` split into four cohesive modules; five LLM prompt scaffolds collapsed into shared helpers.
- The four low-severity correctness fixes (CORE-11, CORE-15, CORE-16) and the naming sweep (TOOL-16, TEST-19).
- Older integration test files migrated to self-owned unique fixtures; silent-pass and destructive-global-mutation patterns removed; unit-style tests moved to `tests/unit/`.

**Non-Goals:**
- No new tools, routes, SQL, or plugin changes. No changes to quota, dedup, or concurrency logic.
- No output-format redesign — formatter extraction preserves current text exactly (snapshot-pinned).
- TEST-18 (eval tier) stays deferred.

## Decisions

### D1 — One `ToolDeps` interface, narrowed per consumer with `Pick`
`index.ts` already constructs every dependency. We define a single `ToolDeps` interface (supabase, logger, aiProvider, all repositories, quotaGate, extractors, timeZone) in a new `tools/tool-deps.ts`; each `register*(server, deps: Pick<ToolDeps, …>)` takes only what it uses. `freshIngest(deps, input)` and `handleIngestNote(deps, args)` follow the same shape. *Alternative considered:* per-module bespoke deps interfaces — rejected because the composition root would build N overlapping objects; `Pick` gives the same narrowing with one source of truth.

### D2 — Extractors and timezone become composition-root wiring
`createDefaultExtractors()` is called once in `index.ts`; the array rides on `ToolDeps.extractors`. `TB_USER_TIMEZONE` is read once alongside the other env reads and threaded as `deps.timeZone` into the pipeline deps (`ExtractionPipelineDeps`), consumed by `TaskExtractor.createRun` via `run.context`. `getConfiguredTimeZone()`'s env read moves to the composition root; date-parser unit tests already pass `timeZone` explicitly. `ExtractionContext.supabase` is deleted (verified consumed by no extractor).

### D3 — Formatter extraction is snapshot-pinned, not re-designed
Before touching `tools/thoughts.ts`/`tasks.ts`/`queries.ts` formatting, unit tests capture current output for fixture rows; the extracted pure helpers (`collectProjectRefs`, `formatProvenance`, `formatThoughtMetadataLines`, `renderTaskLine` with `parentNames`/`showArchived` extensions, exported `taskStatusIcon`/`formatDueDate`) must reproduce it byte-for-byte. The one deliberate behavior change: queries.ts's open-task renderer gains the `status !== "done"` overdue guard by switching to the shared `formatDueDate` — currently masked by its open/in_progress filter, so no visible output change today.

### D4 — Repository splits are interface-level only
`QueryRepository` splits along its own comment boundaries into `ProjectSummaryReads`, `RecentActivityReads`, `NoteSnapshotReads`; `ThoughtRepository` into search/retrieval, write-path, review-queue, usefulness, and erasure roles. The single Supabase class implements all of them (`implements A, B, C`); tool handlers and fakes narrow to the role they use. *Alternative:* splitting the implementation classes too — rejected; one class per table keeps the composition root simple and the split is about consumer coupling, not implementation.

### D5 — `runQuery`/`runWrite` helper owns the envelope
`repo-result.ts` gains `runQuery<Data>(builder)` (awaits a PostgREST builder, returns `{ data, error: toRepoError(error) }`) and a `runWrite` variant for void writes. Methods become one-liners. The REPO-7 count-method fix already landed in Phase C; `runQuery` preserves that error-then-null-data contract.

### D6 — Typed updates via `UpdateRow<Table>`
`supabase-client.ts` gains `UpdateRow<Table>` next to `InsertRow`; the five repository `update` signatures take `Partial<UpdateRow<…>>`. The jsonb `metadata` field uses the same documented one-line bridge the insert paths already use. `listPendingMetadata` types its rows from `Database["public"]["Functions"]["get_pending_ai_output_metadata"]["Returns"]` (the `ThoughtMatchRow` pattern).

### D7 — Task-extractor split is pure moves with re-exports
`similarity.ts` (normalize/LCS/prefilters/computeSimilarity), `task-reconciliation.ts` (greedyMatch, stripMarkersForComparison, reconcileCheckboxes), `task-inference.ts` (the two LLM calls), `task-extractor.ts` (class + merge policy). Existing unit tests pin behavior; `task-extractor.ts` re-exports moved symbols so test imports keep working, then tests are pointed at the new modules. `extractors/llm-helpers.ts` gets `formatEntityList`, `buildIdAllowlist`, `callJsonWithFallback` — the five call sites keep their current per-site fallback values so behavior is unchanged.

### D8 — Test-suite hygiene copies the newer files' patterns
`documents/ai_output/ai_output_http/thoughts(archive)/queries/extractors` migrate to the `uniqueName()` + try/finally self-owned-fixture pattern already used by `tasks.test.ts`/`projects.test.ts`; trailing cleanup tests are deleted; hard-delete replaces archive-as-cleanup. TEST-11's mark-ALL-pending block is replaced by the already-present filtered assertion. TEST-7 uses `callToolRaw` with one always-asserted branch. `makeExtractionContext(overrides)` collapses the ~25 context literals. Unit-style sections (`extractors.test.ts:59-241`, `ai_output.test.ts:262-378`, `extraction_type_allowlist.test.ts`) move to `tests/unit/`. The 50 ms sleep becomes a bounded condition poll; hardcoded 2026 dates become now+30d with `startsWith(date)` assertions (UTC anchoring pinned once in a date-parser unit test).

### Test Strategy
- **Unit:** new tests for extracted formatters (snapshot-equivalence), `runQuery`/`runWrite` error path, `getProjectRefs` filtering (legacy scalar, mixed-type arrays), fence-type tracking (``` block containing `~~~` and mirror), `extractIpAddress` (spoofed multi-hop XFF, garbage → null), `makeExtractionContext`, llm-helpers. Moved unit-style tests keep their assertions.
- **Integration:** the existing suite is the regression net for all refactors; migrated files keep assertion counts equal or higher. No mocks on integrated paths (fakes only at the repository/AiProvider seams in unit tests).
- **E2E-equivalent:** full `deno task test` against a freshly reset stack plus `npm run validate` (`scripts/validate-all.sh`), and the plugin suite (`npm test && npm run build`) to prove no cross-package fallout. GATE 2b: the four behavior fixes each get a test that fails against the pre-fix code (fence, IP, getProjectRefs, silent-pass removal); pure refactors rely on compile-time + snapshot pinning.

### User error scenarios
This change has no new user-facing inputs. Existing error handling is preserved; the relevant "user mistake" surface is unchanged tool inputs already validated by Zod. Developer-error scenarios the design guards: transposing two repositories at a call site (now a compile error via named deps fields), a malformed `x-forwarded-for` header (stored as null, not garbage), legacy scalar `metadata.references` (filtered, not crashed on).

### Security analysis
No new attack surface; two hardenings: (1) CORE-16 stops clients planting arbitrary strings/other people's IPs in `function_call_logs.ip_address` — the forensic trail now records the trusted hop or null (GDPR: IP is personal data; validation also prevents junk PII-adjacent strings). (2) CORE-11 stops unvalidated JSONB flowing into UUID filters. The repository/interface refactors keep the "no Supabase calls outside repositories/" seam intact. `ThreatModel.md` gains a note on XFF trust direction. No API contract changes → no `docs/api-frontend-guide.md` update needed.

## Risks / Trade-offs

- [Refactor breaks output byte-equality] → snapshot the current formatter output in unit tests *before* extracting; diff-assert equivalence; the integration suite's string assertions double-check.
- [Interface splits ripple through many fakes] → the Supabase classes implement all roles, so only test fakes narrow; update fakes file-by-file with the compiler as the guide.
- [Test-file migration destabilizes the suite] → migrate one file at a time, running that file standalone (self-containment is itself the acceptance criterion) before the full run.
- [Moving extractor modules breaks hot-reload during test runs] → per project memory, keep the tree stable during test runs; do all moves, then reset the stack, then run.
- [Large mechanical diff obscures the four real behavior changes] → each behavior fix lands with its own failing-first test named after the finding ID.

## Migration Plan

Single branch `feature/StructurePhaseE`, one change. Order: Step 29 behavior fixes first (small, failing-test-first), then 25 → 26 → 27 → 28 (compile-time refactors, suite green after each), then 30 (test migration last so the refactored code is what the migrated tests pin). Full gates (fresh `npx supabase db reset`, `deno task test`, plugin suite, `npm run validate`) before verify/archive/merge. Rollback: revert the merge commit; no schema or data migration involved.

## Open Questions

None — all findings carry explicit fix instructions from the scan, and the two judgment calls (deps-object shape D1, interface-split granularity D4) are decided above.
