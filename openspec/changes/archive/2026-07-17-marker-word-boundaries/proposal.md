## Why

The due-date marker regexes match markers mid-word. `extractDueDate("Attend Derby March 30")` matches the "by" inside "Derby", corrupting the stored task text to "Attend Der" **and** persisting a due date the user never wrote. This corrupts user data on the primary ingest path (finding EXTR-1). The same defect in `stripMarkersForComparison` skews reconciliation similarity and can cause a re-ingested checkbox to miss its stored task and create a duplicate.

## What Changes

- Require a word boundary before the due-date marker in `date-parser.ts` `DATE_PATTERNS` 1, 3, 4, 5, 6, so a marker embedded in a larger word ("Derby", "standby", "Rugby") is not matched.
- Require a real separator (colon or at least one whitespace) between the marker and its value, so `"by2026-08-01"` inside a token cannot match.
- Apply the same leading word boundary to all four replaces in `stripMarkersForComparison` (`task-extractor.ts`), and replace the over-broad `\w+` in the fourth replace with the month-name alternation so `"Review by section 3 of the doc"` is left unchanged.
- Export `monthPattern` from `date-parser.ts` for reuse by the reconciliation stripper.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-extractor`: Due-date marker matching and reconciliation marker-stripping gain word-boundary and separator requirements so markers are only recognized as standalone words.

## Impact

- `supabase/functions/terrestrial-brain-mcp/extractors/date-parser.ts` (marker patterns, export `monthPattern`)
- `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts` (`stripMarkersForComparison`)
- Tests: `tests/unit/date-parser.test.ts`, `tests/unit/task-extractor-merge.test.ts`
- No schema, API, or dependency changes.

## Non-goals

- No change to which date formats are recognized, to timezone resolution, or to the bare-ISO-date pattern (pattern 2, which already has look-arounds).
- No refactor of the extractor module structure (deferred to EXTR-12/13, Phase E).
