## MODIFIED Requirements

### Requirement: Pipeline initializes knownTasks from note reference_id
The pipeline runner SHALL populate `ExtractionContext.knownTasks` by querying the `tasks` table for rows matching the note's `referenceId`. If the note has no `referenceId`, `knownTasks` SHALL be an empty array.

#### Scenario: Context populated with existing tasks for this note
- **WHEN** the pipeline runs for a note with `referenceId` of `projects/CarChief/sprint.md`
- **AND** the `tasks` table contains 3 tasks with `reference_id = 'projects/CarChief/sprint.md'`
- **THEN** `ExtractionContext.knownTasks` SHALL contain those 3 tasks with their `id`, `content`, and `reference_id`

#### Scenario: Context with no existing tasks for this note
- **WHEN** the pipeline runs for a note that has never been ingested before
- **THEN** `ExtractionContext.knownTasks` SHALL be an empty array

#### Scenario: Note with no referenceId
- **WHEN** the pipeline runs for a note with `referenceId: null` (e.g., captured thought)
- **THEN** `ExtractionContext.knownTasks` SHALL be an empty array
