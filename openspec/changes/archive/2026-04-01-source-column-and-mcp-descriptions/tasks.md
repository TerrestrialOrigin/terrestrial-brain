## 1. Database Migration

- [x] 1.1 Create Supabase migration to `ALTER COLUMN source DROP DEFAULT` on `note_snapshots` table
- [x] 1.2 Verify no other insert paths rely on the default by grepping for `.from("note_snapshots")` and confirming all pass `source` explicitly

## 2. MCP Tool Description Updates

- [x] 2.1 Update `create_ai_output` tool description in `tools/ai_output.ts` to state it should only be called on explicit user request and warn about ingest side effects
- [x] 2.2 Update `create_tasks_with_output` tool description in `tools/ai_output.ts` with the same "only call when explicitly asked" language and ingest warning

## 3. Spec Updates

- [x] 3.1 Update `openspec/specs/note-snapshots.md` to reflect that `source` has no default value

## 4. Testing & Verification

- [x] 4.1 Run all unit tests across packages (`terrestrial-core`, `terrestrial-core-firebase`, `terrestrial-core-algolia`, `terrestrial-core-react`, `core-full-test`)
- [x] 4.2 Run E2E tests (`npx playwright test` in `core-full-test` with emulators)
- [x] 4.3 Verify `npm run build` succeeds for the edge function
- [x] 4.4 Confirm the migration SQL is valid and the existing `handleIngestNote` upsert still works without the DB default
