## 1. Failing tests first (replicate the bugs)

- [x] 1.1 Create `tests/unit/date-parser.test.ts`; move the existing `extractDueDate` cases from `tests/unit/extractor-helpers.test.ts` into it (keep them green).
- [x] 1.2 Add a FAILING timezone-boundary test: evening-EDT instant (e.g. `new Date("2026-03-25T00:30:00Z")`) with `timeZone = "America/New_York"` resolves "by tomorrow" to `2026-03-25` (user-zone), and "today"/day-name/year-inference variants — assert it fails against current UTC behavior.
- [x] 1.3 Add a FAILING bare-ISO boundary test: a URL-embedded date (`Review https://example.com/2026-04-01/report`) and a version string (`Bump to v1.2026-04-01`) yield `dueDate = null` and unchanged text; a standalone `2026-04-01 Fix deployment` still resolves.
- [x] 1.4 Add tests pinning documented behavior: `next Monday` == nearest upcoming Monday; invalid timezone falls back to UTC; Feb 30 → null; New-Year year-inference rollover.
- [x] 1.5 Run `deno task test:unit` and confirm 1.2/1.3 fail for the expected reasons before touching implementation.

## 2. Timezone threading

- [x] 2.1 Add `getZonedDate(referenceDate, timeZone)` to `date-parser.ts` using `Intl.DateTimeFormat` + `formatToParts`; catch `RangeError` on invalid zone, `console.warn` once, fall back to UTC parts.
- [x] 2.2 Add `getConfiguredTimeZone()` helper reading `Deno.env.get("TB_USER_TIMEZONE") ?? "UTC"`.
- [x] 2.3 Change `extractDueDate(text, referenceDate = new Date(), timeZone = "UTC")`; compute zoned "today" once and pass it to the pattern `parse` callbacks (change `DatePattern.parse` signature to take the zoned date).
- [x] 2.4 Refactor `inferYear`, `resolveNextDayOfWeek`, and the "tomorrow" branch to use the zoned date parts + a `Date.UTC(...)` anchor instead of `getUTC*` on the raw reference.
- [x] 2.5 In `task-extractor.ts`: read `getConfiguredTimeZone()` once in `extract()`; pass it into the `extractDueDate` call (~line 676) and into `inferTaskEnrichments`.
- [x] 2.6 In `inferTaskEnrichments`, add a `timeZone` param and build the "Today is …" reference string from the zoned calendar date.

## 3. Bare-ISO word boundary

- [x] 3.1 Update bare-ISO pattern 2 to `(?<![\w/:.\-])(\d{4}[-/]\d{1,2}[-/]\d{1,2})(?![\w/:.\-])`; leave marker-prefixed patterns unchanged.
- [x] 3.2 Confirm the 1.3 boundary tests now pass and the standalone-date regression tests stay green.

## 4. next-weekday semantics

- [x] 4.1 Add a code comment on pattern 6 documenting that `next <weekday>` resolves identically to the bare weekday (nearest upcoming occurrence); confirm the 1.4 test passes.

## 5. Dead-code removal

- [x] 5.1 Delete `inferDatesFromContent`, `containsDateLikeWords`, `DATE_LIKE_WORDS`, `LLMDateResult`, and the `OPENROUTER_BASE`/`OPENROUTER_API_KEY` constants from `date-parser.ts` (grep-verify no other importers).
- [x] 5.2 Delete the `containsDateLikeWords` unit tests from `tests/unit/extractor-helpers.test.ts` and remove the now-unused import there.

## 6. Documentation

- [x] 6.1 Document `TB_USER_TIMEZONE` (purpose, IANA format, default UTC) in `README.md`.

## 7. Testing & Verification

- [x] 7.1 `deno task test:unit` and `deno task test` — zero failures, zero skips (integration suite needs local Supabase + `OPENROUTER_API_KEY`).
- [x] 7.2 `cd obsidian-plugin && npm test && npm run build` — green (no plugin code changed, but the gate is mandatory).
- [x] 7.3 `deno lint` / `deno fmt --check` clean on changed files.
- [x] 7.4 GATE 2b mutation check: revert the timezone/boundary implementation lines and confirm 1.2/1.3 redden; restore.
- [x] 7.5 `/opsx:verify`, then `/opsx:archive`; commit; open PR to `develop`; check Step 9 off in the fix-plan.
