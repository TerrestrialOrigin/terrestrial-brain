## 1. Parser behavior fix (failing-test-first)

- [x] 1.1 Create `tests/unit/parser.test.ts`; add a FAILING test proving the depth 0 → 2 jump orphans the child under current `depth - 1` logic (assert the desired `parentIndex` = parent, watch it fail RED), plus a failing test for `*`/`+` bullet checkboxes not being parsed today
- [x] 1.2 Change `parseCheckboxes` parent detection in `parser.ts` to "nearest preceding checkbox with strictly smaller depth, in the same `sectionHeading`", stopping the scan at a section-heading boundary (D6)
- [x] 1.3 Change `CHECKBOX_PATTERN` to `/^\s*[-*+] \[([ xX])\] (.+)$/` and document the 2-space-per-level indent assumption (vs Obsidian's 4-space default) in `computeIndentDepth`'s JSDoc (D7)
- [x] 1.4 Confirm 1.1's failing tests now pass; run GATE 2b mutation check (revert the parent-detection line → depth-jump test reddens)

## 2. Parser unit-test coverage

- [x] 2.1 Flesh out `tests/unit/parser.test.ts` per the structural-parser delta: headings + line ranges, code-fence exclusion, indent depths (tab/2-space/4-space), bullet variants (`-`/`*`/`+`), non-checkbox bullet ignored, parent resolution (siblings, multi-level, depth jump, section boundary)

## 3. Shared reference keys, types, and factory (pipeline contracts)

- [x] 3.1 Add `REFERENCE_KEYS` (`{ projects, tasks, people } as const`) and shared entity types (`KnownProject`, `KnownTask`; re-export/import `KnownPerson`) to `pipeline.ts`; type the `ExtractionContext` known/newly-created fields with them (keep `newlyCreatedTasks` as its own `{ id, content }` shape) (D2, D3)
- [x] 3.2 Add `createDefaultExtractors()` to `pipeline.ts` returning a fresh `[ProjectExtractor, PeopleExtractor, TaskExtractor]` each call (D1)
- [x] 3.3 Point each extractor's `readonly referenceKey` at `REFERENCE_KEYS.*`, and change `TaskExtractor`'s `accumulatedReferences.projects` read to `accumulatedReferences[REFERENCE_KEYS.projects]`
- [x] 3.4 Replace the four inline `[new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()]` literals in `tools/thoughts.ts` (×2) and `tools/documents.ts` (×2) with `createDefaultExtractors()`
- [x] 3.5 Replace the inline `{ id: string; name: string }` / `{ id: string; content: string; reference_id... }` shapes across `project-extractor.ts`, `people-extractor.ts`, `task-extractor.ts` with the shared types
- [x] 3.6 Add JSDoc on the `Extractor` interface / `ExtractionResult` documenting the ordering requirement and the detect+mutate+enrich side-effect contract (D8)

## 4. Delete delegation wrappers & consolidate markers

- [x] 4.1 Remove `PeopleExtractor.findByName`; call `findPersonByName` from `name-matching.ts` directly at its one call site
- [x] 4.2 Remove `matchPersonInText` (`task-extractor.ts`); call `findPersonInText` directly; update any test importing `matchPersonInText`
- [x] 4.3 Create `extractors/markers.ts` exporting `DUE_MARKERS` / `ASSIGNMENT_MARKERS` and their derived regex fragments (identical token set); rewire `date-parser.ts:247` and the three `task-extractor.ts` marker patterns (`:236-243`, `:526`) to consume them (D5)

## 5. Pipeline & people-extractor unit tests

- [x] 5.1 Create `tests/unit/pipeline.test.ts`: fake extractors (recording order + reading `accumulatedReferences`), fake repositories, fake `AiProvider` — assert runner ordering, cross-extractor context enrichment, and that a returned `errors` array is surfaced (logged), not swallowed; assert `createDefaultExtractors()` returns the three concrete extractors in order
- [x] 5.2 Create `tests/unit/people-extractor.test.ts` with a fake `AiProvider`: hallucinated/unknown LLM person id is dropped (allowlist validation → `knownId` null), explicit known match kept, empty content short-circuits; GATE 2b: removing the `validIds.has(...)` guard reddens the hallucination test

## 6. Verification & gates

- [x] 6.1 Run `deno test --allow-net --allow-env tests/unit/` — all new unit tests green, 0 skips
- [x] 6.2 Run the full Deno suite `deno test --allow-net --allow-env tests/` (local Supabase stack up) — green, 0 failures / 0 skips; `tests/integration/extractors.test.ts` idempotency coverage passes UNCHANGED
- [x] 6.3 `deno check` / `deno lint` on the touched files clean; confirm grep shows no remaining inline `new ProjectExtractor(` at the standard call sites and no bare `"projects"` literal for the cross-extractor read
- [x] 6.4 `cd obsidian-plugin && npm test && npm run build` green (unaffected but part of the standing gate)
- [x] 6.5 `/opsx:verify`, then check off Step 20 in `codeEval/Fable20260704-fix-plan.md`
