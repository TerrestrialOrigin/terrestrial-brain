## Why

The 2026-07-17 code-quality scan (`codeEval/Fable20260717RemediationPlan.md`, Phase E, Steps 25–30) left the last tranche of findings: structure, duplication, and style debt across the edge function, repositories, extractors, and the test suite. None are data-integrity bugs (Phases A–D landed those), but they are binding-directive violations that compound: 8–9 positional same-typed parameters invite silent transposition (CORE-7, TOOL-11, EXTR-9), task/thought formatters exist in three-to-four drifting copies (TOOL-8, TOOL-9), repository seams are god-interfaces with an untyped `update` hole and a ~45×-duplicated result-wrapping block (REPO-2..4, REPO-6), `task-extractor.ts` bundles four modules in 1166 lines with five hand-rolled LLM prompt scaffolds (EXTR-12, EXTR-13), the parser closes a ``` fence with `~~~` (CORE-15), IP telemetry trusts the spoofable end of `x-forwarded-for` (CORE-16), and the older integration test files never migrated to the self-owned-fixture/shared-helper pattern the newer ones follow (TEST-7, TEST-9..17, TEST-19).

## What Changes

- **Deps objects (Step 25 — CORE-7, TOOL-11, TOOL-14, EXTR-9, EXTR-11):** `freshIngest`, every `register*` function, `handleIngestNote`, and `runExtractionPipeline` take typed deps/options objects instead of 7–9 positional parameters; the extractor set is built once at the composition root and injected (no more inline `createDefaultExtractors()` at four call sites); the dead `supabase` handle is removed from `ExtractionContext`; `TB_USER_TIMEZONE` is read once at the composition root and threaded through the pipeline deps instead of a hidden `Deno.env.get` mid-extraction. `freshIngest` is also decomposed into named phase functions (split / per-thought ingest / summary).
- **Formatter dedup (Step 26 — TOOL-8, TOOL-9):** one shared task-line renderer (`renderTaskLine` extended; `taskStatusIcon`/`formatDueDate` exported) replaces the `get_tasks` inline copy and the queries.ts variant — fixing the latent missing `status !== "done"` overdue guard in queries.ts; the verbatim-duplicated project-refs preamble, provenance block, and topics/people/actions metadata lines in `search_thoughts`/`list_thoughts`/`get_thought_by_id`/`capture_thought` are extracted into pure module-level formatters, shrinking the registered handlers to fetch → envelope → format.
- **Repository shape (Step 27 — REPO-2, REPO-3, REPO-4, REPO-6):** `QueryRepository` and `ThoughtRepository` are split along their existing comment boundaries into narrow interfaces (all still implemented by the single Supabase class); a `runQuery`/`runWrite` helper in `repo-result.ts` replaces the ~45 duplicated `{ data, error: toRepoError(error) }` blocks; the five `update(id, Record<string, unknown>)` signatures become `Partial<UpdateRow<Table>>` typed payloads; `listPendingMetadata` returns typed rows derived from the generated RPC return type instead of `unknown[]`.
- **Extractor structure (Step 28 — EXTR-12, EXTR-13):** `task-extractor.ts` splits into `similarity.ts`, `task-reconciliation.ts`, `task-inference.ts`, and the extractor class + merge policy; a shared `extractors/llm-helpers.ts` (`formatEntityList`, `buildIdAllowlist`, `callJsonWithFallback`) replaces the five drifting copies of the entity-list/allowlist/catch-log scaffolding.
- **Core low-severity sweep (Step 29 — CORE-11, CORE-15, CORE-16, TOOL-16):** `getProjectRefs` structurally validates metadata instead of casting; the markdown fence tracker remembers which fence opened a block so a `~~~` line inside a ``` block is content, not a closer; `extractIpAddress` takes the trusted (last) XFF hop and validates IPv4/IPv6 shape before storing, else null; single-letter/abbreviated identifiers (`(a, b)` comparators, `meta`, `ctx`) are renamed.
- **Test suite hygiene (Step 30 — TEST-7, TEST-9..17, TEST-19):** the older integration files (`documents`, `ai_output`, `ai_output_http`, `thoughts` archive section, `queries`, `extractors`) migrate to self-owned uniquely-named fixtures with `try/finally` cleanup; the silent-pass branch in the `get_document` error test and the destructive mark-ALL-pending mutation are removed; inline REST/SSE/tools-list helper copies are replaced with the shared `mcp-client.ts` helpers; the ~25 hand-built `ExtractionContext` literals collapse to a `makeExtractionContext` factory; unit-style tests move to `tests/unit/`; the fixed 50 ms sleep becomes a condition-based wait; hardcoded past dates become clock-derived; single-letter lambda params are renamed.

## Capabilities

### New Capabilities

- `repository-conventions`: cross-repository seam conventions — narrow role-scoped interfaces (3–5 methods), a single shared query-result wrapping helper, schema-typed update payloads, and typed RPC row results (REPO-2, REPO-3, REPO-4, REPO-6).

### Modified Capabilities

- `server-handler-decomposition` (`openspec/specs/server-handler-decomposition/spec.md`): new requirements — typed deps objects for `freshIngest`/`register*`/`handleIngestNote`, extractors wired at the composition root, one shared task-line renderer, and pure extracted thought formatters (CORE-7, TOOL-11, TOOL-14, TOOL-8, TOOL-9).
- `extractor-pipeline` (`openspec/specs/extractor-pipeline/spec.md`): pipeline signature becomes `(note, extractors, deps)`; `ExtractionContext` carries no raw DB handle; timezone is injected via deps (EXTR-9, EXTR-11).
- `task-extractor` (`openspec/specs/task-extractor/spec.md`): the extractor is composed of four cohesive modules and consumes the shared LLM prompt-scaffolding helpers (EXTR-12, EXTR-13).
- `structural-parser` (`openspec/specs/structural-parser/spec.md`): fence detection tracks the opening fence type; a mismatched fence line is in-block content (CORE-15).
- `function-call-logging` (`openspec/specs/function-call-logging/spec.md`): logged `ip_address` comes from the trusted XFF hop and is shape-validated or null (CORE-16).
- `input-validation` (`openspec/specs/input-validation/spec.md`): stored-metadata project references are structurally validated (filter, not cast) before use (CORE-11).
- `code-naming-conventions` (`openspec/specs/code-naming-conventions/spec.md`): sweep scope extends to the remaining flagged sites in `tools/` and `tests/` (TOOL-16, TEST-19).
- `test-infrastructure` (`openspec/specs/test-infrastructure/spec.md`): new requirements — no destructive global-state mutations in tests, no fixed sleeps as synchronization, no silent-pass assertion branches, unit-style tests live under `tests/unit/`, shared extraction-context factory, and fixture-leak rules extended to note snapshots/ai_output rows (TEST-7, TEST-9..17).

## Non-goals

- No behavior changes beyond the three deliberate fixes called out above (queries.ts overdue guard, fence-type tracking, trusted-IP extraction, metadata-refs filtering) — everything else is byte-for-byte output-preserving refactoring pinned by existing tests.
- No changes to the Obsidian plugin (Phase D landed), to SQL/migrations, or to quota/dedup/concurrency logic (Phases A–C landed).
- TEST-18 (eval tier fixture depth) stays deferred per the plan's Deliberate No-Action list.
- No new tools, routes, or repository capabilities — interface splits re-house existing methods without adding any.

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/` — `helpers.ts`, `index.ts`, `parser.ts`, `logger.ts`, `tools/thoughts.ts`, `tools/tasks.ts`, `tools/queries.ts`, `tools/documents.ts`, `repositories/*` (interfaces + implementations + `repo-result.ts`), `extractors/pipeline.ts`, `extractors/task-extractor.ts` (split into new modules), new `extractors/llm-helpers.ts`.
- **Tests:** `tests/integration/documents.test.ts`, `ai_output.test.ts`, `ai_output_http.test.ts`, `thoughts.test.ts`, `queries.test.ts`, `extractors.test.ts`, `ingest_note_route.test.ts`, `enhanced_ingest.test.ts`; moves into `tests/unit/`; updated fakes for narrowed interfaces; new unit tests for extracted formatters, fence tracking, IP extraction, and `getProjectRefs`.
- **No API/DB surface changes:** MCP tool outputs, HTTP routes, and the schema are unchanged (formatting refactors are output-preserving; the overdue-guard fix only affects a display line for done-but-listed tasks, currently masked by filters).
