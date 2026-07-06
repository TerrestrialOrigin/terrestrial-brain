## Why

The extractor pipeline works, but its contracts are implicit and its structure is copy-pasted: the ordered extractor list `[new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()]` is duplicated at four call sites where ordering is load-bearing, the coupling between extractors is a bare `"projects"` magic string, the same `{ id: string; name: string }` shape is re-declared six times, and the `Extractor` interface documents neither its required ordering nor the fact that extractors mutate the database mid-pipeline. Separately, the structural parser has a real behavior bug — a checkbox that jumps from depth 0 to depth 2 is orphaned because parent detection requires an *exact* `depth - 1` match — and it silently ignores `*`/`+` bullet checkboxes. The most complex deterministic files (`parser.ts`, `pipeline.ts`, and the deterministic half of `people-extractor.ts`) have no unit tests, so these contracts and edge cases regress silently. This is fix-plan Step 20.

## What Changes

- Add an exported `createDefaultExtractors()` factory next to the pipeline; replace the four duplicated inline extractor-list literals (`tools/thoughts.ts` ×2, `tools/documents.ts` ×2) with calls to it.
- Introduce a shared `REFERENCE_KEYS` constant (`projects`/`tasks`/`people`); each extractor's `referenceKey` and the `context.accumulatedReferences.projects` read in `TaskExtractor` reference it instead of bare string literals.
- Document the ordering requirement and the "detect + mutate + enrich" side-effect contract directly on the `Extractor` interface / `ExtractionResult` in `pipeline.ts`.
- Export shared entity types `KnownPerson` (already in `name-matching.ts`), `KnownProject`, `KnownTask`; replace the six inline `{ id: string; name: string }` / `{ id: string; content: string }` shapes across the extractors and `ExtractionContext`.
- Remove the pointless one-line delegation wrappers `PeopleExtractor.findByName` and `matchPersonInText` (`task-extractor.ts`) — callers use the shared `name-matching.ts` utilities directly.
- Extract the shared marker vocabulary (`due`/`by`/`deadline`/`before`; `assigned`/`owner`/`assignee`) into one module consumed by `date-parser.ts` and `task-extractor.ts`, which currently redefine it in three drifting places.
- **BREAKING (parser behavior fix):** `parseCheckboxes` parent detection SHALL use the nearest preceding checkbox with a *smaller* depth (not exactly `depth - 1`), so a depth 0 → 2 jump nests correctly instead of orphaning the child. Parent search SHALL NOT cross a section-heading boundary.
- `CHECKBOX_PATTERN` SHALL accept `*` and `+` list bullets in addition to `-`. The 2-space-per-indent-level assumption (vs Obsidian's 4-space default) is documented; both remain supported because a 4-space indent already resolves to a deeper depth.
- Add `tests/unit/parser.test.ts`, `tests/unit/pipeline.test.ts` (fake extractors — runner ordering, context enrichment, error propagation), and deterministic `tests/unit/people-extractor.test.ts` (explicit markers, LLM-output validation against the known-people allowlist, fake `AiProvider`).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `structural-parser`: parent detection changes from exact `depth - 1` to nearest-smaller-depth and stops at section boundaries; checkbox pattern accepts `*`/`+` bullets. (`openspec/specs/structural-parser.md`)
- `extractor-pipeline`: adds the `createDefaultExtractors()` factory as the canonical ordered pipeline, the `REFERENCE_KEYS` reference-key contract, the documented ordering + side-effect contract on `Extractor`, and shared entity types on `ExtractionContext`. (`openspec/specs/extractor-pipeline/spec.md`)

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/parser.ts`, `extractors/pipeline.ts`, `extractors/task-extractor.ts`, `extractors/people-extractor.ts`, `extractors/project-extractor.ts`, `extractors/date-parser.ts`, `extractors/name-matching.ts`; call sites in `tools/thoughts.ts`, `tools/documents.ts`; new `extractors/markers.ts` (marker vocabulary) and `extractors/reference-keys.ts` (or co-located in `pipeline.ts`).
- **Tests:** new `tests/unit/parser.test.ts`, `tests/unit/pipeline.test.ts`, `tests/unit/people-extractor.test.ts`; existing `tests/integration/extractors.test.ts` idempotency coverage must stay green untouched.
- **No DB migration, no dependency, no API-surface change.** Pure internal refactor plus one deterministic parser behavior fix. The parser parent-detection change affects how deeply-jumped subtasks are linked; existing exact-`depth-1` cases are unchanged.
