## 1. Failing tests first (RED)

- [x] 1.1 Add to `tests/unit/date-parser.test.ts`: "Attend Derby March 30" → `dueDate` null, `cleanedText` unchanged; "Test standby 2026-08-01 procedure" → "standby" intact in `cleanedText`; "Rugby Friday practice" → `dueDate` null, "Rugby" intact; plus positive controls that must still pass ("Deploy by Friday", "Review PR due March 30", "Fix deployment by 2026-04-01" — several already exist).
- [x] 1.2 Add to `tests/unit/task-extractor-merge.test.ts`: `stripMarkersForComparison("Review by section 3 of the doc")` === "Review by section 3 of the doc".
- [x] 1.3 Run `deno task test:unit` and confirm the new negative tests FAIL for the expected reason (marker matched mid-word / `\w+` over-strip).

## 2. Fix (GREEN)

- [x] 2.1 In `date-parser.ts`, add `MARKER_BOUNDARY = "\\b"` and `MARKER_SEPARATOR = "(?:\\s*:\\s*|\\s+)"`; interpolate the boundary before `${markerPattern}` and use the separator in place of `\s*:?\s*` in patterns 1, 3, 4, 5, 6.
- [x] 2.2 Export `monthPattern` from `date-parser.ts`.
- [x] 2.3 In `task-extractor.ts` `stripMarkersForComparison`, add `\b` before the marker in all four replaces and replace the `\w+` in the fourth replace with `(?:${monthPattern})` (import `monthPattern`).
- [x] 2.4 Re-run `deno task test:unit`; confirm the new tests pass and all pre-existing date-parser/merge tests stay green.

## 3. Testing & Verification

- [x] 3.1 GATE 2b: temporarily revert the regex change and confirm the new negative tests re-redden.
- [x] 3.2 Run the full `deno task test` against a freshly reset stack; `deno lint` and `deno fmt --check` clean.
- [x] 3.3 `/opsx:verify`, then `/opsx:archive`; check off Step 1 in the remediation plan checklist; commit.
