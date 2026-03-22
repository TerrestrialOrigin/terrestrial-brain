# Tasks

## Pipeline Integration

- [x] Add `getProjectRefs()` backwards-compat helper to `helpers.ts`
- [x] Update `freshIngest()` signature to accept `noteSnapshotId` and `references` parameters
- [x] Remove inline project detection from `freshIngest()` LLM prompt
- [x] Pass `noteSnapshotId` and `references` through to thought inserts in `freshIngest()`

## Enhanced ingest_note

- [x] Add note snapshot upsert at start of `ingest_note` (ON CONFLICT reference_id DO UPDATE)
- [x] Add structural parser + extractor pipeline call after snapshot upsert
- [x] Wire pipeline references and snapshot ID into fresh ingest path
- [x] Wire pipeline references and snapshot ID into reconciliation path (update + add operations)
- [x] Remove inline project detection from reconciliation LLM prompt
- [x] Update return message to include task and project counts

## Enhanced capture_thought

- [x] Add structural parser + extractor pipeline call to `capture_thought`
- [x] Pass pipeline references into thought insert metadata
- [x] Handle pipeline errors gracefully (non-fatal, empty references fallback)

## Testing & Verification

- [x] Create `tests/integration/enhanced_ingest.test.ts` with tests:
  - ingest_note with checkboxes populates tasks table
  - ingest_note thoughts have `references.tasks` array
  - ingest_note stores note content in `note_snapshots`
  - ingest_note re-sync updates snapshot (not duplicated)
  - ingest_note re-sync with checkbox state change updates task status
  - capture_thought with task-like content extracts tasks
  - Backwards compat: `getProjectRefs()` handles old and new format
- [x] Run all existing tests (extractors, thoughts, parse) to verify no regressions
