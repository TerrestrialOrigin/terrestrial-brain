## Context

`date-parser.ts` resolves relative dates ("today", "tomorrow", weekday names) and infers omitted years using `Date.prototype.getUTC*` methods on the reference instant. When the server clock (UTC) and the user's wall clock straddle midnight, the resolved calendar date is off by a day — e.g. a checkbox saved at 20:30 EDT (00:30 UTC) resolves "tomorrow" to two days out. `due_by` is stored as a `timestamptz` at midnight-UTC of the resolved calendar date, which is a date-only concept.

Two secondary defects live in the same file: the **bare** ISO pattern `/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/` matches dates inside URLs/version strings and strips them from task content; and ~80 lines of dead code (`containsDateLikeWords`, `inferDatesFromContent`, plus the `OPENROUTER_*` constants and `LLMDateResult` type only they use) remain, including a whole unused LLM prompt path.

Current callers: `task-extractor.ts:676` calls `extractDueDate(text)` with the default (`new Date()`, UTC); `inferTaskEnrichments` (`task-extractor.ts:442`) builds its LLM "Today is …" reference string with `referenceDate.toISOString().split("T")[0]` (UTC). `extractDueDate` already accepts an injectable `referenceDate` used by the unit tests.

## Goals / Non-Goals

**Goals:**
- Relative-date resolution ("today"/"tomorrow"/weekday names) and year inference compute the calendar date in a configured user timezone, not UTC.
- The LLM enrichment path receives the same zone-correct "today" string.
- Bare ISO dates embedded in URLs/version strings are not captured or stripped; standalone bare ISO dates and marker-prefixed dates still work.
- `next <weekday>` has documented, tested semantics.
- Dead code removed; `date-parser.ts` unit-tested with a fixed reference date.

**Non-Goals:**
- Migrating `due_by` to a `date` column (see Decision 2).
- Per-user timezones or timezone detection from the note/plugin. One server-wide `TB_USER_TIMEZONE` is the scope here; a per-request timezone can layer on later without changing the function signatures introduced now.
- Reworking the marker-prefixed date patterns (patterns 1, 3–6), which are unaffected by the boundary fix.

## Decisions

### Decision 1 — Compute the reference calendar date in the user's zone via `Intl.DateTimeFormat`
Add `getZonedDate(referenceDate: Date, timeZone: string): { year; month; day; weekday }` that uses `Intl.DateTimeFormat("en-US", { timeZone, year, month, day, weekday })` + `formatToParts` to read the wall-clock calendar date/weekday of the instant in `timeZone`. All relative helpers (`inferYear`, `resolveNextDayOfWeek`, the "tomorrow" branch) take this zoned "today" instead of calling `getUTC*` on the raw `Date`. Date arithmetic (add-a-day, add-N-days-to-weekday) is done on a `Date.UTC(year, month, day)` anchor built from the zoned parts, so the result stays in the calendar-date domain and `buildISODate` emits midnight-UTC of the correct calendar date.

- *Why `Intl` over a date library:* zero new dependencies, built into the Deno/V8 runtime, and it is the canonical correct way to get wall-clock parts for an IANA zone (handles DST transitions). Alternatives — hand-rolled fixed offsets (breaks on DST) or a library like Luxon (new dep for one function) — are worse.
- *Invalid timezone:* `Intl.DateTimeFormat` throws `RangeError` on an unknown zone. `getZonedDate` catches it, `console.warn`s once with the offending value, and falls back to UTC parts. This is "validate at the boundary" — a bad env var degrades gracefully instead of crashing every ingest.

### Decision 2 — Keep `due_by` as `timestamptz` at midnight-UTC (no migration)
`due_by` represents a date-only deadline. We continue storing midnight-UTC of the resolved calendar date. The bug was never the storage type — it was computing the wrong *calendar date*. Converting to a `date` column would touch the schema, every read/format site, and existing rows for no behavioral gain once the calendar date is correct.
- *Trade-off:* a midnight-UTC timestamp displayed naively in a negative-offset zone can render as the previous evening. Acceptable: consumers treat `due_by` as a date, and the value is stable/consistent. Revisit only if a real display bug surfaces.
- *Alternative considered:* `date` column — rejected as scope creep (a migration + broad read-site churn) disproportionate to the fix.

### Decision 3 — Configuration via `TB_USER_TIMEZONE` env var, default `UTC`
The timezone is read once per extraction run in `TaskExtractor.extract` via a small `getConfiguredTimeZone()` helper (`Deno.env.get("TB_USER_TIMEZONE") ?? "UTC"`) and passed explicitly into `extractDueDate(text, referenceDate, timeZone)` and `inferTaskEnrichments(..., timeZone)`. No hidden module-level singleton, and the pure functions stay unit-testable by injecting `timeZone` directly.
- *Why env, not per-note:* matches the single-operator deployment model; a real seam that a later per-request timezone can replace without signature churn. Fail-fast on a *missing* var is not wanted here — absence has a sensible default (UTC).

### Decision 4 — Bare-ISO word boundary via look-around
Change bare-ISO pattern 2 to `(?<![\w/:.\-])(\d{4}[-/]\d{1,2}[-/]\d{1,2})(?![\w/:.\-])`. The date must not be flanked by word chars, `/`, `:`, `.`, or `-` — the characters that surround dates inside URLs (`/2026-04-01/`), timestamps (`2026-04-01T…`), and version strings (`v1.2026-04-01`). Start/end-of-string and whitespace/parens still qualify, so `"2026-04-01 Fix deployment"` still matches. V8 (Deno) supports look-behind. Marker-prefixed patterns are untouched, so `"due 2026-04-01"` still resolves via pattern 1.

### Decision 5 — `next <weekday>` = nearest upcoming occurrence (documented, not changed)
English "next Monday" is genuinely ambiguous. The current pattern already accepts an optional `next` and resolves both `"Monday"` and `"next Monday"` to the nearest upcoming Monday (`daysAhead` in 1..7). Rather than pick a contested "+1 week" interpretation and risk surprising users, we keep this behavior, document it explicitly on the pattern and in the spec, and pin it with a test. (Fix-plan permits "handle OR explicitly document".)

### Decision 6 — Remove dead code and relocate tests
Delete `containsDateLikeWords`, `inferDatesFromContent`, `DATE_LIKE_WORDS`, `LLMDateResult`, and the `OPENROUTER_BASE`/`OPENROUTER_API_KEY` constants (used by nothing else in the file). Move the date-parser cases out of `extractor-helpers.test.ts` into a new `tests/unit/date-parser.test.ts` and delete the `containsDateLikeWords` cases with the function.

### Test Strategy
Pure functions with an injectable `referenceDate`/`timeZone` → **unit tests** (Deno, no DB/network/LLM) are the right and sufficient layer. New `tests/unit/date-parser.test.ts`:
- Timezone-boundary (failing-first): evening-EDT instant + `America/New_York` resolves "tomorrow"/"today" to the user-zone calendar date, not the UTC one.
- Bare-ISO boundary (failing-first): a URL/version-embedded date is NOT captured (dueDate null, text unchanged); a standalone bare ISO date still is.
- Regression coverage moved from `extractor-helpers.test.ts`: markers, natural dates, ordinals, abbreviations, year inference (incl. New-Year rollover), invalid dates (Feb 30 → null), `next <weekday>`, no-date.
The task-extractor integration path (env → extractDueDate) is exercised by the existing `extractors` integration suite; no mock is introduced on the parse path.

## User Error / Edge Scenarios

- **Invalid `TB_USER_TIMEZONE`** (typo, non-IANA string) → `getZonedDate` catches the `RangeError`, warns, and uses UTC. Ingest never crashes.
- **Unset `TB_USER_TIMEZONE`** → defaults to `UTC` (prior behavior preserved for existing deployments).
- **Impossible calendar date** ("Feb 30", "2026-13-40") → `buildISODate` already round-trips through `Date.UTC` and returns `null`; the fragment is left in the text rather than producing a bogus date.
- **Date inside a URL/version** ("see https://x.com/2026-04-01/report") → not captured; task content preserved intact.
- **Ambiguous "next Monday"** → resolves to the nearest upcoming Monday per Decision 5 (documented).

## Security Analysis

Low surface. `TB_USER_TIMEZONE` is a server-side operator-set env var, not user input, and flows only into `Intl.DateTimeFormat`'s `timeZone` option — no injection sink. Removing the `inferDatesFromContent` LLM path removes an API-key-reading network call, shrinking surface. No secrets, auth, or PII paths are touched. The look-around regex operates on already-bounded checkbox text; no catastrophic-backtracking risk (fixed-shape numeric groups). No new `ThreatModel.md` entry warranted.

## Risks / Trade-offs

- **Midnight-UTC display in negative-offset zones** → consumers treat `due_by` as date-only; documented (Decision 2). Mitigation: revisit only on a concrete display bug.
- **Look-behind portability** → V8/Deno supports it; the edge runtime is V8. Mitigation: unit test asserts both URL-embedded (no match) and standalone (match) cases, so a regex regression fails loudly.
- **Timezone read at module vs call scope** → read once per `extract()` run to avoid per-checkbox env lookups while keeping the pure functions injectable. No request-scoped state stored in module mutables.

## Migration Plan

None. No schema change, no data backfill. Deploy is a function redeploy. Rollback = redeploy prior function; `due_by` values written under either version are valid `timestamptz`. Operators wanting non-UTC resolution set `TB_USER_TIMEZONE` (documented in README); doing nothing preserves current UTC behavior.
