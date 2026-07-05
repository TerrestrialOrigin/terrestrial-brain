## Why

Relative due dates ("today", "tomorrow", "by Friday") are resolved using the server's UTC clock, so a task captured at 20:00 EDT resolves a calendar day late. The bare-ISO date pattern also matches dates embedded in URLs and version strings and strips them from task text, and the file carries ~80 lines of never-called LLM/heuristic dead code. These are correctness bugs in the date-parser (fix-plan Step 9, eval finding C7) that ship wrong `due_by` values to users.

## What Changes

- Thread a user timezone (new `TB_USER_TIMEZONE` env var, default `UTC`) into `extractDueDate` and the LLM enrichment reference date so "today"/"tomorrow"/day-name/year-inference resolve in the user's zone rather than UTC. An invalid/unknown timezone falls back to UTC with a warning (validate at the boundary).
- Require a word boundary around the **bare** ISO date pattern so dates inside URLs and version strings (`.../2026-04-01/...`, `v1.2026-04-01`) are no longer captured and stripped from task content. Marker-prefixed ISO dates (`due 2026-04-01`) are unaffected.
- Explicitly document `next <weekday>` semantics (resolves identically to the bare weekday — the nearest upcoming occurrence) in code and design, and pin it with a test.
- **BREAKING (internal API only):** remove the dead exports `containsDateLikeWords` and `inferDatesFromContent` (and the now-orphan `OPENROUTER_*` constants, `DATE_LIKE_WORDS` regex, and `LLMDateResult` type they alone use). Grep-verified: called only by their own unit tests.
- Add `tests/unit/date-parser.test.ts` with fixed-`referenceDate` coverage: timezone-boundary cases (evening-EST "tomorrow"), day names, ordinals, year inference around New Year, invalid dates (Feb 30), and URL-embedded dates NOT matching. Relocate the existing date-parser cases from `tests/unit/extractor-helpers.test.ts`.

`due_by` remains a `timestamptz` storing midnight-UTC of the resolved calendar date (a date-only concept); no migration. Trade-off recorded in design.md.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-extractor`: the "Due date extraction from checkbox text" requirement changes — relative dates resolve in a configured user timezone (not UTC), the bare-ISO pattern requires a word boundary, and `next <weekday>` semantics are specified. Delta spec: `openspec/specs/task-extractor/spec.md`.

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/extractors/date-parser.ts` (timezone threading, bare-ISO boundary, dead-code removal); `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts` (reads `TB_USER_TIMEZONE`, passes timezone into `extractDueDate` and `inferTaskEnrichments`).
- **Tests:** new `tests/unit/date-parser.test.ts`; `tests/unit/extractor-helpers.test.ts` loses its date-parser + `containsDateLikeWords` cases (moved/deleted).
- **Config:** new optional env var `TB_USER_TIMEZONE` (IANA zone name, default `UTC`) — documented in README.
- **Data:** no schema change; no migration. `due_by` stays `timestamptz` midnight-UTC.
- **Dependencies:** none.
