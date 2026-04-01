## 1. capture_thought Implementation

- [x] 1.1 Add `author` and `project_ids` parameters to `capture_thought` input schema in `tools/thoughts.ts`
- [x] 1.2 Update the insert logic to set `reliability = 'reliable'` and `author` from the parameter
- [x] 1.3 Merge explicit `project_ids` into `references.projects` (union with pipeline results, deduplicated)
- [x] 1.4 Update the MCP tool description to position capture_thought as the designated AI-caller function

## 2. Testing & Verification

- [x] 2.1 Add integration test: capture_thought sets `reliability = 'reliable'` on inserted thought
- [x] 2.2 Add integration test: capture_thought stores `author` when provided
- [x] 2.3 Add integration test: capture_thought leaves `author = null` when omitted
- [x] 2.4 Add integration test: capture_thought merges explicit `project_ids` with pipeline-detected projects
- [x] 2.5 Update `openspec/specs/thoughts.md` with the modified capture_thought spec
- [x] 2.6 Run full integration test suite and verify 0 failures, 0 skips
