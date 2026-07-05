## MODIFIED Requirements

### Requirement: Due date extraction from checkbox text

TaskExtractor SHALL detect date references in checkbox text and populate the `due_by` field. Relative and partial dates ("today", "tomorrow", weekday names, and dates with an omitted year) SHALL be resolved against the current calendar date in a configured user timezone (`TB_USER_TIMEZONE` env var, IANA zone name, default `UTC`), NOT against the server's UTC clock. An invalid or unknown timezone value SHALL fall back to `UTC` without failing extraction. Resolved dates SHALL be stored in `due_by` as a `timestamptz` at midnight-UTC of the resolved calendar date.

#### Scenario: ISO date in checkbox text
- **WHEN** a checkbox contains text like "Fix deployment by 2026-04-01"
- **THEN** the task's `due_by` SHALL be set to "2026-04-01T00:00:00Z" and the date fragment SHALL be stripped from `content`

#### Scenario: Natural date in checkbox text
- **WHEN** a checkbox contains text like "Review PR due March 30"
- **THEN** the task's `due_by` SHALL be set to the corresponding date and the date fragment SHALL be stripped from `content`

#### Scenario: Relative date in checkbox text
- **WHEN** a checkbox contains text like "Deploy by Friday"
- **THEN** the task's `due_by` SHALL be set to the next upcoming occurrence of that weekday relative to the current date in the configured timezone, and the date fragment SHALL be stripped from `content`

#### Scenario: Relative date resolves in the configured timezone, not UTC
- **WHEN** a checkbox containing "by tomorrow" is ingested at an instant that falls on a different calendar day in the configured `TB_USER_TIMEZONE` than in UTC (e.g. 20:30 in a negative-offset zone, past midnight UTC)
- **THEN** the task's `due_by` SHALL be the day after the *user-zone* calendar date, not the day after the UTC calendar date

#### Scenario: Invalid timezone falls back to UTC
- **WHEN** `TB_USER_TIMEZONE` is set to a value that is not a valid IANA timezone
- **THEN** relative-date resolution SHALL fall back to UTC and extraction SHALL complete without error

#### Scenario: "next" weekday resolves to the nearest upcoming occurrence
- **WHEN** a checkbox contains text like "due next Monday"
- **THEN** the task's `due_by` SHALL be set to the nearest upcoming Monday (identical to a bare "Monday" reference), and the "next"-prefixed fragment SHALL be stripped from `content`

#### Scenario: Bare ISO date embedded in a URL or version string is not captured
- **WHEN** a checkbox contains a bare ISO-formatted date immediately flanked by URL or version characters (e.g. "Review https://example.com/2026-04-01/report" or "Bump to v1.2026-04-01")
- **THEN** the task's `due_by` SHALL remain null and the checkbox `content` SHALL be left unchanged (the embedded date SHALL NOT be stripped)

#### Scenario: Standalone bare ISO date is still captured
- **WHEN** a checkbox contains a bare ISO date delimited by whitespace or string boundaries (e.g. "2026-04-01 Fix deployment")
- **THEN** the task's `due_by` SHALL be set to that date and the date fragment SHALL be stripped from `content`

#### Scenario: No date in checkbox text
- **WHEN** a checkbox contains no recognizable date reference
- **THEN** the task's `due_by` SHALL remain null and `content` SHALL be unchanged

#### Scenario: LLM fallback for ambiguous dates
- **WHEN** regex parsing cannot resolve a date but the text contains date-like words (month names, "deadline", "due")
- **THEN** TaskExtractor SHALL batch those checkboxes into a single LLM call to resolve dates, using the configured-timezone calendar date as the reference "today"
