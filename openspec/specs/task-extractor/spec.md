# task-extractor Specification

## Purpose
TBD - created by archiving change people-table. Update Purpose after archive.
## Requirements
### Requirement: Task schema includes assigned_to
The tasks table SHALL have an optional `assigned_to` column (uuid, nullable) referencing `people(id)` with ON DELETE SET NULL.

#### Scenario: Task created without assignment
- **WHEN** a task is created via `create_task` without `assigned_to`
- **THEN** the task's `assigned_to` SHALL be null

#### Scenario: Task assigned to a person
- **WHEN** `create_task` is called with a valid `assigned_to` person UUID
- **THEN** the task SHALL be created with that person's UUID in `assigned_to`

#### Scenario: Task updated with assignment
- **WHEN** `update_task` is called with `assigned_to` set to a valid person UUID
- **THEN** the task's `assigned_to` SHALL be updated to that UUID

#### Scenario: Task assignment cleared
- **WHEN** `update_task` is called with `assigned_to` set to null
- **THEN** the task's `assigned_to` SHALL be set to null

#### Scenario: Assigned person deleted
- **WHEN** a person referenced by `assigned_to` is deleted from the people table
- **THEN** the task's `assigned_to` SHALL be set to null (ON DELETE SET NULL)

#### Scenario: List tasks shows assigned person name
- **WHEN** `list_tasks` returns tasks that have `assigned_to` set
- **THEN** the output SHALL include the assigned person's name for each task

#### Scenario: Project summary shows assigned person name
- **WHEN** `get_project_summary` returns tasks that have `assigned_to` set
- **THEN** the task list in the output SHALL include the assigned person's name

#### Scenario: Task auto-assigned during extraction
- **WHEN** TaskExtractor creates or updates a task and a known person's name appears in the checkbox text or section heading
- **THEN** the task's `assigned_to` SHALL be set to that person's UUID

### Requirement: Extracted tasks have populated metadata

TaskExtractor SHALL populate the `metadata` JSONB field on every task it creates or updates with extraction context.

#### Scenario: New task extracted from checkbox
- **WHEN** TaskExtractor creates a new task from a parsed checkbox
- **THEN** the task's `metadata` SHALL contain `source` (string, e.g. "obsidian"), `section_heading` (string or null — the nearest heading above the checkbox), and `extraction_method` (one of "heading_match", "file_path", "ai_inference", "none" — indicating how project_id was resolved)

#### Scenario: Existing task updated on re-ingest
- **WHEN** TaskExtractor updates a matched existing task during reconciliation
- **THEN** the task's `metadata` SHALL be refreshed with current extraction context (same fields as new task creation)

#### Scenario: Checkbox under a heading
- **WHEN** a checkbox is parsed under the heading "## Sprint 12"
- **THEN** the resulting task's `metadata.section_heading` SHALL be "Sprint 12"

#### Scenario: Checkbox with no heading above
- **WHEN** a checkbox has no heading above it in the note
- **THEN** the resulting task's `metadata.section_heading` SHALL be null

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

### Requirement: People assignment from checkbox context

TaskExtractor SHALL assign `assigned_to` when a known person is referenced in or near the checkbox.

#### Scenario: Person name in checkbox text
- **WHEN** a checkbox's text contains the full name of a known person (case-insensitive)
- **THEN** the task's `assigned_to` SHALL be set to that person's UUID and the person's name SHALL remain in the content (not stripped)

#### Scenario: Person name in section heading
- **WHEN** a checkbox's `sectionHeading` contains the full name of a known person but the checkbox text does not
- **THEN** the task's `assigned_to` SHALL be set to that person's UUID

#### Scenario: No person match
- **WHEN** neither the checkbox text nor its section heading contains a known person's name
- **THEN** the task's `assigned_to` SHALL remain null

#### Scenario: Multiple people in checkbox text
- **WHEN** a checkbox's text contains multiple known person names
- **THEN** the task's `assigned_to` SHALL be set to the first matched person (by order of appearance in text)

### Requirement: matchPersonInText supports partial name matching
The `matchPersonInText` function SHALL first attempt full-name substring matching, then fall back to individual name-part matching against the text. In BOTH tiers, a match SHALL count only when the matched substring is bounded on each side by a word boundary — that is, the character immediately before and immediately after the matched substring is either absent (start/end of text) or a non-word character. A character SHALL be considered a word character when it is a Unicode letter or number (`\p{L}` or `\p{N}`), so accented names (e.g. "José") are treated as whole words. For partial matches, it SHALL return a result only when exactly one person's name part is found in the text. Full-name matches SHALL take priority over partial matches, using earliest-position selection among boundary-valid full-name occurrences.

#### Scenario: Full name found in text matches as before
- **WHEN** task text is "Review Bub Goodwin's PR" and "Bub Goodwin" is a known person
- **THEN** matchPersonInText SHALL return Bub Goodwin's ID

#### Scenario: First name found in text matches when unambiguous
- **WHEN** task text is "Ask Bub about the deploy" and the only known person with name part "Bub" is "Bub Goodwin"
- **THEN** matchPersonInText SHALL return Bub Goodwin's ID

#### Scenario: Last name found in text matches when unambiguous
- **WHEN** task text is "Goodwin will handle this" and the only known person with name part "Goodwin" is "Bub Goodwin"
- **THEN** matchPersonInText SHALL return Bub Goodwin's ID

#### Scenario: Ambiguous partial name in text returns no match
- **WHEN** task text is "John will review" and known people include "John Smith" and "John Doe"
- **THEN** matchPersonInText SHALL return null

#### Scenario: Full name match takes priority over partial
- **WHEN** task text is "Alice and Alice Cooper will pair" and known people include "Alice" (id-1) and "Alice Cooper" (id-2)
- **THEN** matchPersonInText SHALL return id-2 (earliest full-name match "Alice Cooper") or id-1 (earliest position "Alice"), following existing earliest-position logic

#### Scenario: Single-word full name embedded in a longer word does not match
- **WHEN** task text is "Planning the sprint" and "Ann" is the only known person
- **THEN** matchPersonInText SHALL return null because "Ann" appears only inside the word "Planning"

#### Scenario: Full name adjacent to punctuation still matches
- **WHEN** task text is "talk to Bub." or "(Bub) owns this" and "Bub Goodwin" is the only person with name part "Bub"
- **THEN** matchPersonInText SHALL return Bub Goodwin's ID because the surrounding punctuation is a word boundary

#### Scenario: Accented name matched as a whole word
- **WHEN** task text is "José reviewed it" and "José" is the only known person
- **THEN** matchPersonInText SHALL return José's ID

#### Scenario: Accented name embedded in a longer word does not match
- **WHEN** task text is "Josély signed off" and "José" is the only known person
- **THEN** matchPersonInText SHALL return null because "José" is followed by the letter "l" and is not a whole word

### Requirement: Re-ingest merge preserves fields when resolution is unavailable

When `TaskExtractor` updates a matched (existing) task on re-ingest, it SHALL distinguish, per field (`project_id`, `due_by`, `assigned_to`), between "resolution ran and found no value" (available-empty) and "resolution could not run to completion" (unavailable — the batched LLM call errored, or no capability existed to resolve the field). A field SHALL be written as `null` (cleared) ONLY when its resolution was available-empty. When resolution is unavailable, the extractor SHALL omit that column from the update so the stored value is preserved. When a value is resolved, the extractor SHALL write that value.

#### Scenario: LLM project inference error preserves existing project_id
- **WHEN** a matched task already has `project_id = P` and, on re-ingest, project resolution for its checkbox falls through to LLM inference and the LLM call fails (non-OK response or thrown error)
- **THEN** the update SHALL NOT set `project_id` and the task SHALL retain `project_id = P`

#### Scenario: No known projects preserves existing project_id
- **WHEN** a matched task already has `project_id = P` and, on re-ingest, there are no known projects and no heading/pipeline project resolves for its checkbox
- **THEN** the update SHALL NOT set `project_id` and the task SHALL retain `project_id = P`

#### Scenario: Successful project resolution to a value updates project_id
- **WHEN** a matched task's checkbox resolves to project `Q` (via heading, pipeline reference, or a successful LLM assignment)
- **THEN** the update SHALL set `project_id = Q`

#### Scenario: LLM enrichment error preserves existing due_by and assigned_to
- **WHEN** a matched task already has `due_by = D` and `assigned_to = A`, the note no longer states a date or assignee via fast paths, and the batched enrichment LLM call fails
- **THEN** the update SHALL NOT set `due_by` or `assigned_to` and the task SHALL retain `due_by = D` and `assigned_to = A`

### Requirement: Re-ingest merge clears fields removed from the note when resolution is available

When `TaskExtractor` updates a matched task and resolution for a field completed successfully (available) but found no value — the user removed the date/assignee/project cue from the checkbox — it SHALL clear that field by writing `null`, so the stored task matches the note. This applies consistently to `project_id`, `due_by`, and `assigned_to`.

#### Scenario: Removed due date is cleared
- **WHEN** a matched task previously had `due_by = D`, the re-ingested checkbox contains no date via regex, and the enrichment LLM call succeeds and returns no date for that task
- **THEN** the update SHALL set `due_by = null`

#### Scenario: Removed assignee is cleared
- **WHEN** a matched task previously had `assigned_to = A`, the re-ingested checkbox contains no assignment via fast paths, and the enrichment LLM call succeeds and returns no assignee for that task
- **THEN** the update SHALL set `assigned_to = null`

#### Scenario: Removed project cue clears project_id when inference is available
- **WHEN** a matched task previously had `project_id = P`, no heading or pipeline project resolves, and the LLM project inference call succeeds but does not assign that checkbox to any project
- **THEN** the update SHALL set `project_id = null`

### Requirement: Extraction surfaces Supabase write failures

`TaskExtractor` SHALL check the error channel of every Supabase write it performs — the matched-task update, the parent-link update, the archive-removed update, and the new-task insert — and SHALL surface any write failure in the `ExtractionResult` via an `errors` array rather than silently ignoring it. The extraction pipeline runner SHALL log surfaced errors rather than discarding them.

#### Scenario: Failed matched-task update is surfaced
- **WHEN** the Supabase update for a matched task returns an error
- **THEN** `TaskExtractor.extract` SHALL include a message identifying the failed write in `result.errors`

#### Scenario: Failed archive update is surfaced
- **WHEN** the Supabase archive update for a removed task returns an error
- **THEN** `TaskExtractor.extract` SHALL include a message identifying the failed write in `result.errors`

#### Scenario: Successful extraction reports no errors
- **WHEN** all Supabase writes during extraction succeed
- **THEN** `result.errors` SHALL be absent or empty

