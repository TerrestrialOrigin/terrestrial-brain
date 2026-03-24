## 1. Database Schema

- [x] 1.1 Create migration for `people` table (id, name, type, email, description, metadata, archived_at, created_at, updated_at) with UNIQUE on name, CHECK on type, indexes, and updated_at trigger
- [x] 1.2 Create migration to add `assigned_to` uuid column on `tasks` table with FK to `people(id)` ON DELETE SET NULL and index
- [x] 1.3 Update `supabase/seed.sql` with test people rows (at least one human, one AI)

## 2. MCP Tools — People CRUD

- [x] 2.1 Create `tools/people.ts` with `create_person` tool (name required, type/email/description optional)
- [x] 2.2 Add `list_people` tool (filters: type, include_archived)
- [x] 2.3 Add `get_person` tool (by id, includes open assigned task count)
- [x] 2.4 Add `update_person` tool (name, type, email, description)
- [x] 2.5 Add `archive_person` tool (sets archived_at)
- [x] 2.6 Register people tools in `index.ts`

## 3. Update Existing Tools

- [x] 3.1 Update `create_task` and `update_task` to accept optional `assigned_to` parameter
- [x] 3.2 Update `list_tasks` to resolve and display assigned person names
- [x] 3.3 Update `get_project_summary` in `queries.ts` to display assigned person names on tasks

## 4. PeopleExtractor

- [x] 4.1 Create `extractors/people-extractor.ts` implementing the Extractor interface with LLM-based detection against known people
- [x] 4.2 Extend `ExtractionContext` in `pipeline.ts` with `knownPeople` and `newlyCreatedPeople` arrays
- [x] 4.3 Update `runExtractionPipeline` to fetch active people into context on initialization
- [x] 4.4 Wire PeopleExtractor into pipeline in `tools/thoughts.ts` (ingest_note and capture_thought)

## 5. Testing & Verification

- [x] 5.1 Add integration tests for PeopleExtractor (known match, no match, empty known list, empty content)
- [x] 5.2 Add integration tests for pipeline context enrichment with people
- [x] 5.3 Verify all existing extractor tests still pass
- [x] 5.4 Verify the edge function builds without errors
- [x] 5.5 Run full test suite and confirm 0 failures, 0 skips
