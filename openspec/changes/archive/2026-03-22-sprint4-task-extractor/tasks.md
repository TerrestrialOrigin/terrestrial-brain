## 1. Database Migration

- [x] 1.1 Create migration `supabase/migrations/YYYYMMDD_tasks_reference_id.sql` — add `reference_id text null` column to tasks table with index
- [x] 1.2 Verify migration applies cleanly against local Supabase (`supabase db reset`)

## 2. Pipeline Context Update

- [x] 2.1 Update `runExtractionPipeline()` in `pipeline.ts` — accept note's `referenceId`, query tasks filtered by `reference_id`, populate `knownTasks` in context
- [x] 2.2 Update pipeline function signature to pass `referenceId` (or derive from `note.referenceId`)

## 3. TaskExtractor Core

- [x] 3.1 Create `extractors/task-extractor.ts` with `TaskExtractor` class implementing `Extractor`
- [x] 3.2 Implement checkbox-to-task conversion — map each `ParsedCheckbox` to a task insert with content, status (open/done), reference_id, and archived_at (for done tasks)
- [x] 3.3 Implement subtask hierarchy — use `parentIndex` to set `parent_id` from the DB ID of the already-processed parent task
- [x] 3.4 Implement content similarity matching — normalize text and compute overlap for fuzzy matching (>80% threshold)

## 4. Task Reconciliation

- [x] 4.1 Implement reconciliation logic — match each checkbox against `knownTasks` by exact content, then fuzzy content with line position tiebreaker
- [x] 4.2 Implement task update on re-ingest — update content (if edited), status (checked/unchecked), project_id, parent_id for matched tasks
- [x] 4.3 Implement status transitions — `- [ ]` reopens done tasks (clear archived_at), `- [x]` marks open tasks done (set archived_at)

## 5. Project Association

- [x] 5.1 Implement section heading project match — compare `sectionHeading` against known projects (case-insensitive)
- [x] 5.2 Implement file path project default — use project IDs from ProjectExtractor's result as fallback for unassigned tasks
- [x] 5.3 Implement AI content inference — batch LLM call for remaining unassigned tasks, parse JSON response, validate project IDs against known list
- [x] 5.4 Implement LLM error handling — catch failures, continue with deterministic associations only

## 6. Context Enrichment

- [x] 6.1 Add newly created tasks to `context.newlyCreatedTasks` after processing
- [x] 6.2 Return `ExtractionResult` with `referenceKey: "tasks"` and all task IDs (matched + created)

## 7. Testing & Verification

- [x] 7.1 Write TaskExtractor tests — unchecked checkbox creates open task with reference_id
- [x] 7.2 Write TaskExtractor tests — checked checkbox creates done task with archived_at
- [x] 7.3 Write TaskExtractor tests — indented checkboxes create subtask hierarchy (parent_id)
- [x] 7.4 Write TaskExtractor tests — tasks under project heading get correct project_id
- [x] 7.5 Write TaskExtractor tests — re-ingest with unchanged checkbox doesn't duplicate
- [x] 7.6 Write TaskExtractor tests — re-ingest with checked box updates status to done
- [x] 7.7 Write TaskExtractor tests — re-ingest with unchecked box reopens task
- [x] 7.8 Write TaskExtractor tests — re-ingest with new checkbox creates new task, keeps existing
- [x] 7.9 Write TaskExtractor tests — note with no checkboxes returns empty result
- [x] 7.10 Write pipeline integration test — both ProjectExtractor + TaskExtractor produce composed references
- [x] 7.11 Write pipeline context test — knownTasks populated from DB for matching reference_id
- [x] 7.12 Run all existing test suites (parse, thoughts, projects, tasks, ai_notes, extractors) to verify no regressions
- [x] 7.13 Verify app builds and MCP server starts without errors
