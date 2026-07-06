## Context

The extractor pipeline (`extractors/pipeline.ts` + the three concrete extractors) is the best-architected part of the repo — it has a real `Extractor` interface and layered deterministic-before-LLM heuristics — but its contracts leak through copy-paste and magic strings, and the deterministic `parser.ts` it feeds has an un-tested parent-detection bug. This change (fix-plan Step 20) hardens those contracts and the parser without changing the LLM-driven behavior.

Current state relevant to this change:

- The ordered list `[new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()]` appears verbatim at four call sites (`tools/thoughts.ts:611-615, 1201`; `tools/documents.ts:79-81, 341-343`). Ordering is load-bearing: `TaskExtractor` reads `context.accumulatedReferences.projects` (`task-extractor.ts:840`), which only exists if `ProjectExtractor` ran first.
- Each extractor hard-codes its `referenceKey` string (`"projects"`, `"tasks"`, `"people"`) and `TaskExtractor` reads `accumulatedReferences.projects` by bare literal.
- `{ id: string; name: string }` is re-declared inline six times (`pipeline.ts` context fields, `people-extractor.ts`, `project-extractor.ts`, `task-extractor.ts`); `KnownPerson` already exists in `name-matching.ts` but is not reused.
- `PeopleExtractor.findByName` and `matchPersonInText` are one-line pass-throughs to `name-matching.ts`.
- Marker vocabulary (`due|by|deadline|before`, `assigned|owner|assignee`) is defined in `date-parser.ts:247` and re-hardcoded in `task-extractor.ts:236-243, 526`.
- `parser.ts:194-207` parent detection requires an exact `depth - 1` match and scans backward across section boundaries; `CHECKBOX_PATTERN` (`parser.ts:41`) only matches `- [ ]`.
- `parser.ts`, `pipeline.ts`, and the deterministic half of `people-extractor.ts` have zero unit tests.

Constraints: Deno edge runtime, no new dependencies, no DB migration, and the existing `tests/integration/extractors.test.ts` re-ingest idempotency suite (the strongest existing coverage) must stay green **untouched**.

## Goals / Non-Goals

**Goals:**
- One canonical, ordered pipeline factory used by every call site.
- Reference keys and entity shapes named once and reused, so a rename is a single edit and the ordering coupling is explicit.
- The `Extractor` interface documents its ordering requirement and its detect+mutate+enrich side-effect contract.
- Fix the parser parent-detection bug (depth-jump orphaning) and accept `*`/`+` bullets, both pinned by unit tests written failing-first.
- Establish `tests/unit/` coverage for `parser.ts`, `pipeline.ts`, and `people-extractor.ts`'s deterministic parts.

**Non-Goals:**
- No change to LLM prompts, model, or the extraction *decisions* the LLM makes.
- No conversion of extractors from mutating side effects to returned "intents" — the eval floats that as an ideal, but it is a larger redesign; this change only *documents* the current side-effect contract (recorded as an accepted trade-off below).
- No repository/AiProvider seam changes (done in Steps 15–17).
- No behavior change to date parsing beyond sourcing marker tokens from a shared module (identical token set).

## Decisions

### D1. `createDefaultExtractors()` factory co-located in `pipeline.ts`
Export `createDefaultExtractors(): Extractor[]` returning a fresh `[new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()]` each call. A fresh array (not a shared singleton) because extractors are currently stateless but callers pass the array into `runExtractionPipeline`, and a shared mutable array invites accidental coupling. Co-located in `pipeline.ts` (not a new file) because it is the pipeline's own concern and avoids a circular import (`pipeline.ts` would import the concrete extractors; the extractors import only the interface/types from `pipeline.ts`, so this is one-directional and fine).
- *Alternative — keep a module-level `const DEFAULT_EXTRACTORS`:* rejected; a shared array instance is a footgun and the allocation cost per ingest is negligible.

### D2. `REFERENCE_KEYS` constant object
`export const REFERENCE_KEYS = { projects: "projects", tasks: "tasks", people: "people" } as const;` in `pipeline.ts`. Each extractor sets `readonly referenceKey = REFERENCE_KEYS.projects` (etc.), and `TaskExtractor` reads `context.accumulatedReferences[REFERENCE_KEYS.projects]`. This makes the cross-extractor dependency (TaskExtractor needs ProjectExtractor's output) greppable and rename-safe.
- *Alternative — a TS enum:* rejected; a `const` object with `as const` is idiomatic in this Deno codebase and avoids enum's runtime quirks.

### D3. Shared entity types
Reuse the existing `KnownPerson` from `name-matching.ts`; add `KnownProject = { id: string; name: string }` and `KnownTask = { id: string; content: string; reference_id: string | null }`. Home them in `pipeline.ts` (they describe the `ExtractionContext` shape) and re-export `KnownPerson` from there for a single import site, or import each from its natural module. Replace the six inline shapes. `newlyCreatedTasks` keeps its `{ id: string; content: string }` shape (no `reference_id`) as a distinct type `NewTaskRef` — do not force it into `KnownTask`, because conflating "known task with a reference" and "just-created task id+content" would be a lie in the types.
- *Alternative — one mega type with optional fields:* rejected; optional fields erase the real distinction the code relies on.

### D4. Delete delegation wrappers
Remove `PeopleExtractor.findByName` (call `findPersonByName` directly) and `matchPersonInText` (call `findPersonInText` directly). Pure inlining; no behavior change. Update the one export consumer (`task-extractor.ts` internal callers) and any test that imported `matchPersonInText` to import `findPersonInText` from `name-matching.ts`.

### D5. Shared marker vocabulary module `extractors/markers.ts`
Export `DUE_MARKERS = ["due","by","deadline","before"]` and `ASSIGNMENT_MARKERS = ["assigned","owner","assignee"]`, plus derived regex fragments `DUE_MARKER_PATTERN` / `ASSIGNMENT_MARKER_PATTERN` (e.g. `(?:due|by|deadline|before)`) so both `date-parser.ts` and `task-extractor.ts` build their regexes from the same source. The token set is **identical** to today's union, so no matching behavior changes. `task-extractor.ts` currently strips date markers with two literal patterns (`:236-243`) and assignment markers with one (`:526`); all reference the shared fragment.
- *Alternative — leave date markers in `date-parser` and import from there:* rejected; `date-parser` and `task-extractor` are peers, so a neutral `markers.ts` avoids an awkward peer import and matches the eval's "one module" recommendation.

### D6. Parser parent detection: nearest-smaller-depth, section-bounded (the behavior fix)
Change `parseCheckboxes` parent search from "nearest preceding checkbox with `depth === current.depth - 1`" to "nearest preceding checkbox with `depth < current.depth`", and stop the backward scan when it reaches a checkbox in a **different section** (different `sectionHeading`) — a subtask never parents to a checkbox under a different heading. This fixes the depth 0 → 2 orphaning (child now attaches to the depth-0 item) while leaving every existing exact-`depth-1` case unchanged (the nearest smaller depth of a depth-1 child under a depth-0 parent is still that parent).
- *User-error scenario — inconsistent indentation:* a note where the author jumps 0 → 2 (a common real mistake, e.g. pasting from a 4-space editor) previously silently dropped the parent link; now it nests to the nearest shallower item, matching author intent. A note that *de*-dents past all parents (depth 2 with no shallower preceding checkbox in-section) correctly yields `parentIndex = null`.
- *Alternative — clamp depths to be contiguous in a pre-pass:* rejected; rewriting the author's depths is more surprising than resolving parents leniently.

### D7. Checkbox bullet variants
`CHECKBOX_PATTERN` becomes `/^\s*[-*+] \[([ xX])\] (.+)$/`. Markdown list items legitimately start with `-`, `*`, or `+`; Obsidian renders all three. No other pattern change. The 2-space-per-level indent assumption is **documented** in `computeIndentDepth`'s JSDoc: Obsidian's default is 4 spaces, which this parser reads as depth 2 for a single indent — acceptable because relative nesting (D6's nearest-smaller-depth) is preserved regardless of the multiplier, and tabs (Obsidian's other default) are already 1 level each. We do NOT try to auto-detect 2- vs 4-space; documenting the assumption is sufficient and avoids fragile heuristics.
- *Alternative — support 4-space as depth 1 via detection:* rejected; nearest-smaller-depth parent resolution makes the absolute multiplier irrelevant for correctness, so detection adds risk for no behavioral gain.

### D8. Documentation-only contract on `Extractor`
Add JSDoc to the `Extractor` interface and `ExtractionResult` stating (a) extractors run in a fixed order and may depend on earlier extractors' `accumulatedReferences` (ProjectExtractor → TaskExtractor), and (b) `extract` performs DB writes as a side effect (detect + mutate + enrich), so a mid-pipeline failure can leave partial writes — surfaced via `ExtractionResult.errors`, not swallowed. No runtime change.

### Test Strategy
- **Unit (new `tests/unit/`):**
  - `parser.test.ts` — parent detection (incl. the failing-first 0→2 depth-jump and section-boundary cases), bullet variants (`*`/`+`), indent depths, heading ranges, code-fence exclusion. Pure functions, no I/O.
  - `pipeline.test.ts` — `runExtractionPipeline` with **fake extractors** (recording call order), fake repositories, and a fake `AiProvider`: asserts ordering, `accumulatedReferences` enrichment between extractors, and that an extractor's `errors` are surfaced (logged) not swallowed. `createDefaultExtractors()` returns the three concrete extractors in order.
  - `people-extractor.test.ts` — deterministic parts only, with a **fake `AiProvider`**: a hallucinated/unknown person id from the LLM is dropped (validated against the known-people allowlist → `knownId: null`), an explicit known match is kept, empty content short-circuits. No network.
- **Integration (unchanged):** `tests/integration/extractors.test.ts` re-ingest idempotency is the safety net for the refactor and must pass **without modification**. If any integration test needs editing, that is a signal the refactor changed behavior — investigate rather than edit.
- **Mutation check (GATE 2b):** for the parser fix, deleting the nearest-smaller-depth line must redden the depth-jump test; for allowlist validation, removing the `validIds.has(...)` guard must redden the people-extractor hallucination test.

### Security analysis
- The people-extractor allowlist-validation test hardens an existing defense (LLM cannot inject a foreign person id) with explicit coverage — reduces risk of a future regression silently allowing hallucinated ids into `metadata.references`.
- No new external input surface, no new secret handling, no auth path touched. The marker/reference refactors are internal. Parser changes operate on already-trusted note content (same trust boundary as before). No SSRF/injection surface introduced.

## Risks / Trade-offs

- **[Parser parent-detection change alters existing links for depth-jumped notes]** → It only *adds* parent links where there were none (orphans) or moves a link to a nearer shallower item; it never removes a correct existing link. Covered by failing-first + regression unit tests, and the integration idempotency suite guards against ingest-level surprises.
- **[Accepting `*`/`+` bullets could match lines previously treated as prose]** → Only lines already shaped exactly like `[*+] [ ] text` are affected; these were almost certainly intended as checkboxes. Unit tests assert both new-match and non-match (e.g. `* not a checkbox`).
- **[Side-effect contract documented but not eliminated]** → Converting extractors to pure intent-returning functions is deliberately out of scope (Non-Goal). Documenting the contract is the agreed minimum for this step; the larger redesign is left for a future change.
- **[Shared marker module drift risk if a future marker is added in only one place]** → Mitigated structurally: after this change there is exactly one definition, and both consumers import it, so adding a marker is a single edit.
