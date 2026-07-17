## Context

`extractors/date-parser.ts` builds six `DATE_PATTERNS` by interpolating `markerPattern` (`(?:due|by|deadline|before)`) into larger regexes. Patterns 1, 3, 4, 5, 6 are marker-anchored; the marker is preceded only by `\(?\s*`, which imposes no left boundary, so the marker can match mid-word ("by" in "Derby"). The marker-to-value separator is `\s*:?\s*`, which permits zero whitespace, so `"by2026-08-01"` could match. Pattern 2 (bare ISO) already has look-arounds and is out of scope. `stripMarkersForComparison` in `task-extractor.ts` has the same missing-boundary defect across its four replaces, and its fourth replace uses `\w+` where a month name is intended, so "Review by section 3" is wrongly stripped to "Review of the doc".

Confirmed by execution in the finding: `extractDueDate("Attend Derby March 30")` → `{cleanedText: "Attend Der", dueDate: "2027-03-30..."}`.

## Goals / Non-Goals

**Goals:**
- A due-date marker matches only as a standalone word.
- A marker requires a real separator (colon or ≥1 whitespace) before its value.
- `stripMarkersForComparison` gains the same boundaries and matches a real month name, not any `\w+`.
- All existing positive date-parsing behavior is preserved (existing tests stay green).

**Non-Goals:**
- No change to recognized date formats, timezone resolution, or the bare-ISO pattern.
- No extractor module restructuring (EXTR-12/13, Phase E).

## Decisions

- **Boundary mechanism: ASCII `\b`.** Markers are ASCII; `\b` before the marker gives the exact "standalone word" semantics without requiring the `u` flag (which risks changing escape semantics in the existing hand-built patterns). The plan permits `\b` as the ASCII option. A shared constant `MARKER_BOUNDARY = "\\b"` is interpolated immediately before `${markerPattern}` in patterns 1, 3, 4, 5, 6.
- **Separator requirement.** Replace `\s*:?\s*` with `MARKER_SEPARATOR = "(?:\\s*:\\s*|\\s+)"` — either a colon with optional surrounding whitespace, or at least one whitespace. This still accepts "(deadline: 2026-04-01)", "deadline:2026", "due March 30", "(by tomorrow)"; it rejects "by2026-08-01".
- **Export `monthPattern`.** `date-parser.ts` already computes `monthPattern` (all month full+short names). Export it so `stripMarkersForComparison`'s fourth replace can use `(?:${monthPattern})` instead of `\w+`.
- **`stripMarkersForComparison` boundaries.** The two paren-form replaces (`\(\s*MARKER\s*:...\)`) already have `(` as a left boundary; add `\b` before the marker for consistency and to guard `(assignedto:` style tokens. The two bare-form replaces (`(?:,?\s*)MARKER...`) get `\b` before the marker.

### User error scenarios

- User writes an ordinary word containing a marker substring ("Derby", "standby", "Rugby", "before-hand" without a value) → no false due date, text preserved.
- User writes a marker jammed against the value ("by2026-08-01") → not treated as a marker date (separator required). This is the safe direction: a genuine date jammed to a marker is rare, and the standalone bare-ISO pattern still catches a whitespace-delimited ISO date.

### Security analysis

No new external input surface, no auth or query changes. Regex-only change on already-authenticated ingest text. ReDoS: the added `\b` and bounded separator alternation introduce no unbounded backtracking; patterns remain linear. No ThreatModel entry required.

### Test Strategy

Unit-only (pure functions, no DB/network/LLM). Layer: Deno unit tests. Write failing tests first (GATE 2b: reverting the regex change must re-redden them).

## Risks / Trade-offs

- **Risk:** `\b` treats `_` as a word char, differing subtly from `(?<![\p{L}\p{N}])` on underscore-adjacent markers ("foo_by"). Accepted: underscore-jammed markers are not a real due-date form, and this direction only makes matching stricter.
- **Trade-off:** Requiring a separator rejects "by2026-08-01". Accepted per the finding; the standalone bare-ISO pattern still captures whitespace-delimited ISO dates.
