## ADDED Requirements

### Requirement: ingest_note stores note snapshot

The `ingest_note` tool SHALL upsert a row in `note_snapshots` before splitting the note into thoughts. The upsert uses `ON CONFLICT (reference_id) DO UPDATE` to store the latest version.

#### Scenario: First ingest creates snapshot
- **WHEN** `ingest_note` is called with `content`, `title`, and `note_id` for a note not previously ingested
- **THEN** a new row SHALL be inserted into `note_snapshots` with `reference_id = note_id`, `title`, `content`, and `source = 'obsidian'`

#### Scenario: Re-ingest updates snapshot
- **WHEN** `ingest_note` is called with a `note_id` that already has a row in `note_snapshots`
- **THEN** the existing row SHALL be updated with the new `content`, `title`, and `captured_at = now()` — no duplicate rows created

#### Scenario: ingest_note without note_id skips snapshot
- **WHEN** `ingest_note` is called without a `note_id`
- **THEN** no row SHALL be inserted into `note_snapshots` and `note_snapshot_id` on thoughts SHALL be NULL

---

### Requirement: ingest_note runs extractor pipeline

The `ingest_note` tool SHALL run the structural parser and extractor pipeline (ProjectExtractor, TaskExtractor) on the note content before splitting into thoughts.

#### Scenario: ingest_note with checkboxes populates tasks table
- **WHEN** `ingest_note` is called with content containing `- [ ]` checkboxes
- **THEN** the TaskExtractor SHALL create corresponding rows in the `tasks` table with appropriate `reference_id`, `status`, and `project_id`

#### Scenario: ingest_note detects projects via pipeline
- **WHEN** `ingest_note` is called with content that references a known project (by file path, heading, or content)
- **THEN** the ProjectExtractor SHALL detect the project and include its ID in the pipeline references

#### Scenario: Pipeline failure does not block ingest
- **WHEN** the extractor pipeline throws an error during `ingest_note`
- **THEN** the tool SHALL log the error and continue with empty references (`{ projects: [], tasks: [] }`)

---

### Requirement: ingest_note populates thoughts with references and snapshot

All thoughts created or updated during `ingest_note` SHALL receive the `note_snapshot_id` from the snapshot upsert and `metadata.references` from the pipeline.

#### Scenario: Fresh ingest thoughts have references and snapshot
- **WHEN** `ingest_note` performs a fresh ingest (no prior thoughts)
- **THEN** each inserted thought SHALL have `note_snapshot_id` set and `metadata.references` containing `{ projects: [...], tasks: [...] }`

#### Scenario: Reconciliation thoughts have references and snapshot
- **WHEN** `ingest_note` reconciles with existing thoughts (update/add operations)
- **THEN** updated and added thoughts SHALL have `note_snapshot_id` set and `metadata.references` containing `{ projects: [...], tasks: [...] }`

---

### Requirement: ingest_note return message includes extraction summary

#### Scenario: Return message includes task and project counts
- **WHEN** `ingest_note` completes successfully with extracted tasks and projects
- **THEN** the return message SHALL include task and project counts (e.g., "2 tasks detected, 1 project linked")

---

### Requirement: capture_thought runs extractor pipeline

The `capture_thought` tool SHALL run the structural parser and extractor pipeline on the captured content to detect projects and tasks.

#### Scenario: capture_thought with project mention populates references
- **WHEN** `capture_thought` is called with content that mentions a known project
- **THEN** the thought SHALL be inserted with `metadata.references.projects` containing the detected project ID

#### Scenario: capture_thought with checkboxes creates tasks
- **WHEN** `capture_thought` is called with content containing `- [ ]` checkboxes
- **THEN** the TaskExtractor SHALL create task rows and the thought SHALL have `metadata.references.tasks` with the task IDs

#### Scenario: capture_thought has null snapshot
- **WHEN** `capture_thought` is called
- **THEN** the thought SHALL have `note_snapshot_id = NULL` and `reference_id = NULL`

---

### Requirement: getProjectRefs backwards compatibility helper

A `getProjectRefs()` function SHALL read project references from thought metadata, supporting both old and new formats.

#### Scenario: Read new format
- **WHEN** metadata contains `references.projects` as an array
- **THEN** `getProjectRefs()` SHALL return that array

#### Scenario: Read old format
- **WHEN** metadata contains `references.project_id` as a string (no `projects` array)
- **THEN** `getProjectRefs()` SHALL return a single-element array `[project_id]`

#### Scenario: No references
- **WHEN** metadata has no `references` field or references is empty
- **THEN** `getProjectRefs()` SHALL return an empty array
