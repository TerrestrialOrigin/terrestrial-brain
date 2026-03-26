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

TaskExtractor SHALL detect date references in checkbox text and populate the `due_by` field.

#### Scenario: ISO date in checkbox text
- **WHEN** a checkbox contains text like "Fix deployment by 2026-04-01"
- **THEN** the task's `due_by` SHALL be set to "2026-04-01T00:00:00Z" and the date fragment SHALL be stripped from `content`

#### Scenario: Natural date in checkbox text
- **WHEN** a checkbox contains text like "Review PR due March 30"
- **THEN** the task's `due_by` SHALL be set to the corresponding date and the date fragment SHALL be stripped from `content`

#### Scenario: Relative date in checkbox text
- **WHEN** a checkbox contains text like "Deploy by Friday"
- **THEN** the task's `due_by` SHALL be set to the next occurrence of that day relative to the current date and the date fragment SHALL be stripped from `content`

#### Scenario: No date in checkbox text
- **WHEN** a checkbox contains no recognizable date reference
- **THEN** the task's `due_by` SHALL remain null and `content` SHALL be unchanged

#### Scenario: LLM fallback for ambiguous dates
- **WHEN** regex parsing cannot resolve a date but the text contains date-like words (month names, "deadline", "due")
- **THEN** TaskExtractor SHALL batch those checkboxes into a single LLM call to resolve dates

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
The `matchPersonInText` function SHALL first attempt full-name substring matching (existing behavior), then fall back to individual name-part matching against the text. For partial matches, it SHALL return a result only when exactly one person's name part is found in the text. Full-name matches SHALL take priority over partial matches.

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

