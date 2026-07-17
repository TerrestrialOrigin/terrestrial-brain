## ADDED Requirements

### Requirement: Due-date markers are matched only as standalone words

Due-date marker words ("due", "by", "deadline", "before") SHALL be recognized only when they appear as standalone words, not as a substring inside a larger word. A marker SHALL additionally require a real separator — a colon or at least one whitespace character — between the marker and the date value it introduces. This prevents corrupting task text and inventing due dates from words that merely contain a marker as a substring.

#### Scenario: Marker embedded inside a word is not matched (natural date)

- **WHEN** a checkbox contains text like "Attend Derby March 30" (where "by" is a substring of "Derby")
- **THEN** the task's `due_by` SHALL remain null and `content` SHALL be left as "Attend Derby March 30" (unchanged)

#### Scenario: Marker embedded inside a word is not matched (ISO date)

- **WHEN** a checkbox contains text like "Test standby 2026-08-01 procedure" (where "by" is a substring of "standby")
- **THEN** the marker-anchored ISO pattern SHALL NOT strip "by 2026-08-01" from the text; the standalone bare-ISO pattern MAY still capture the standalone date, but the word "standby" SHALL remain intact in `content`

#### Scenario: Marker embedded inside a word is not matched (weekday)

- **WHEN** a checkbox contains text like "Rugby Friday practice" (where "by" is a substring of "Rugby")
- **THEN** the task's `due_by` SHALL remain null and "Rugby" SHALL remain intact in `content`

#### Scenario: Standalone marker still parses its date

- **WHEN** a checkbox contains a standalone marker and value like "Deploy by Friday", "Review PR due March 30", or "Fix deployment by 2026-04-01"
- **THEN** the task's `due_by` SHALL be resolved as before and the marker-plus-date fragment SHALL be stripped from `content`

### Requirement: Reconciliation marker-stripping respects word boundaries

`stripMarkersForComparison` SHALL strip due/assignment markers only when they appear as standalone words, and the natural-date stripping SHALL match an actual month name rather than any word. Comparison text SHALL NOT be corrupted by a marker that is a substring of an ordinary word.

#### Scenario: Marker as a substring of a word is preserved during comparison stripping

- **WHEN** `stripMarkersForComparison` is called on "Review by section 3 of the doc"
- **THEN** the returned string SHALL be "Review by section 3 of the doc" (unchanged), because "by section 3" is not a marker-plus-month-date fragment
