## 1. Core low-severity behavior fixes (Step 29 — failing tests first)

- [x] 1.1 CORE-15: write failing unit tests (``` block containing `~~~` + `- [ ] fake task` → zero checkboxes; mirror case), then change `parser.ts` `inBlock: boolean` to `openFence: "```" | "~~~" | null` closing only on the matching fence type
- [x] 1.2 CORE-16: write failing unit tests (spoofed multi-hop XFF → trusted last hop; garbage value → null), then rewrite `logger.ts` `extractIpAddress` to prefer the last XFF element, validate IPv4/IPv6 shape else null, and document the trusted proxy chain in a comment
- [x] 1.3 CORE-11: write failing unit tests (`references: "old-string"` → empty; `projects: [42, "uuid"]` → only the string), then replace the casts in `helpers.ts` `getProjectRefs` with structural checks + string filtering
- [x] 1.4 TOOL-16: rename `(a, b)` comparator params in `tools/tasks.ts`, `meta` → `extractedMetadata`/`metadataRecord` and `ctx` → `context` in `tools/thoughts.ts`

## 2. Deps objects (Step 25 — CORE-7, TOOL-11, TOOL-14, EXTR-9, EXTR-11)

- [x] 2.1 Define the shared `ToolDeps` interface (supabase, logger, aiProvider, all repositories, quotaGate, extractors, timeZone) in `tools/tool-deps.ts`; build the extractor array and read `TB_USER_TIMEZONE` once in `index.ts`
- [x] 2.2 Change every `register*` signature to `(server, deps: Pick<ToolDeps, …>)` and update `createMcpServer`
- [x] 2.3 Change `freshIngest` to `(deps, input)` with named fields (`noteId`, not `note_id`); extract `splitIntoThoughts` and `buildIngestSummary` phase functions; update the caller in `tools/thoughts.ts`
- [x] 2.4 Change `handleIngestNote` to `(deps, args)`; replace the four inline `createDefaultExtractors()` calls with injected `deps.extractors`; add a unit test proving a fake extractor set is injectable
- [x] 2.5 EXTR-9/EXTR-11: change `runExtractionPipeline` to `(note, extractors, deps: ExtractionPipelineDeps)`; delete `ExtractionContext.supabase`; thread `timeZone` through deps into `createRun` (remove the `Deno.env.get` from `getConfiguredTimeZone` usage in extraction); update the four call sites

## 3. Formatter dedup (Step 26 — TOOL-8, TOOL-9)

- [x] 3.1 Snapshot-pin current output: unit tests capturing `get_tasks` task lines, project-summary open-task lines, and search/list/get-thought text for fixture rows (must pass against current code)
- [x] 3.2 TOOL-8: extend `renderTaskLine` with optional `parentNames`/`showArchived`; export `taskStatusIcon` + `formatDueDate` (with the `status !== "done"` overdue guard); switch `get_tasks` and `tools/queries.ts` open-task rendering to the shared helpers; assert byte-equality with the snapshots
- [x] 3.3 TOOL-9: extract pure `collectProjectRefs`, `formatProvenance`, `formatThoughtMetadataLines`, and composed `formatSearchResult`/`formatListEntry`; shrink the `search_thoughts`/`list_thoughts`/`get_thought_by_id` handlers to query → envelope → resolve → touch → format; assert byte-equality with the snapshots

## 4. Repository shape (Step 27 — REPO-2, REPO-3, REPO-4, REPO-6)

- [x] 4.1 REPO-3: add `runQuery`/`runWrite` helpers to `repo-result.ts` (+ unit test for the error path keeping `data: null`); rewrite the ~45 wrapping blocks across the `supabase-*-repository.ts` implementations
- [x] 4.2 REPO-4: add `UpdateRow<Table>` alias in `supabase-client.ts`; change the five `update` signatures to `Partial<UpdateRow<…>>` (with the documented jsonb metadata bridge); fix caller fallout
- [x] 4.3 REPO-2: split `QueryRepository` into `ProjectSummaryReads`/`RecentActivityReads`/`NoteSnapshotReads` and `ThoughtRepository` into role interfaces along its comment boundaries; keep the single implementing classes; narrow handler param types and test fakes to the role used
- [x] 4.4 REPO-6: type `listPendingMetadata` rows from the generated RPC return type (`PendingAiOutputMetadataRow`); remove the `unknown[]` from the interface and the handler

## 5. Extractor structure (Step 28 — EXTR-12, EXTR-13)

- [x] 5.1 EXTR-12: move similarity/LCS/prefilter code to `extractors/similarity.ts`, greedy-match/marker-strip/reconcile to `extractors/task-reconciliation.ts`, the two LLM calls to `extractors/task-inference.ts`; keep class + merge policy in `task-extractor.ts` with re-exports; suite green after the move
- [x] 5.2 EXTR-13: add `extractors/llm-helpers.ts` (`formatEntityList`, `buildIdAllowlist`, `callJsonWithFallback`); rewrite the five scaffold copies in `people-extractor.ts`, `project-extractor.ts`, and `task-inference.ts` on top, preserving each site's fallback and label

## 6. Test suite hygiene (Step 30 — TEST-7, TEST-9..17, TEST-19)

- [x] 6.1 TEST-7: rewrite the `get_document` nonexistent-id test with `callToolRaw` and one always-asserted branch
- [x] 6.2 TEST-14: move the mock-extractor pipeline section of `extractors.test.ts`, the `generateTaskMarkdown` section of `ai_output.test.ts`, and `extraction_type_allowlist.test.ts` into `tests/unit/`
- [x] 6.3 TEST-13: add `makeExtractionContext(overrides)` and collapse the ~25 context literals
- [x] 6.4 TEST-9/10/16: migrate `documents.test.ts`, `ai_output.test.ts`, `ai_output_http.test.ts`, and the archive section of `thoughts.test.ts` to self-owned `uniqueName()` fixtures with try/finally cleanup registered before assertions; delete trailing cleanup tests; hard-delete projects; clean note_snapshots/ai_output companion rows; fix `queries.test.ts` fixture names and the leaked task; unique `note_id` in `ingest_note_route.test.ts`
- [x] 6.5 TEST-11: replace the mark-ALL-pending block with fixture-scoped emptiness assertions
- [x] 6.6 TEST-12: sweep inline REST fetch blocks to `restUrl()`/`serviceHeaders()`; move `toolNames()` into `tests/helpers/mcp-client.ts` and use it in the three tools/list re-implementations; delete the re-declared constants in `ingest_note_route.test.ts`/`extractors.test.ts`
- [x] 6.7 TEST-15: drop the 50 ms sleep in `documents.test.ts` (timestamp comparison or bounded poll); TEST-17: clock-derive the due-date fixtures with `startsWith` assertions and pin UTC anchoring in one date-parser unit test
- [x] 6.8 TEST-19: rename the flagged single-letter lambda params and the `del` helper across the listed test files
- [x] 6.9 Standalone/double-run check: run each migrated integration file twice in a row without a reset and confirm both runs pass

## 7. Testing & Verification

- [x] 7.1 Full backend suite against a fresh stack: `npx supabase db reset`, warm the function, then `deno task test` — zero failures, zero skips
- [x] 7.2 Plugin suite unaffected: `cd obsidian-plugin && npm test && npm run build`
- [x] 7.3 `npm run validate` / `scripts/validate-all.sh` green end-to-end
- [x] 7.4 GATE 2b spot-checks: revert each Step-29 fix in memory and confirm its new test reddens; confirm deleting a shared formatter/deps field breaks compilation or a snapshot test
- [x] 7.5 Walk every delta-spec scenario and confirm the implementation satisfies it; update `ThreatModel.md` with the XFF trust note
