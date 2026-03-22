## 1. Tool Module — get_project_summary

- [x] 1.1 Create `tools/queries.ts` with register function accepting McpServer + SupabaseClient
- [x] 1.2 Implement `get_project_summary` tool: fetch project, parent, children, open tasks, recent thoughts (with backwards-compatible references filtering), source note snapshots
- [x] 1.3 Format output as human-readable text with clear sections

## 2. Tool Module — get_recent_activity

- [x] 2.1 Implement `get_recent_activity` tool: fetch thoughts, tasks created, tasks completed, projects, AI outputs delivered within time window
- [x] 2.2 Format output with sections per entity type, including counts and details

## 3. Registration

- [x] 3.1 Register `queries` module in `index.ts`

## 4. Testing & Verification

- [x] 4.1 Create `tests/integration/queries.test.ts` with tests for both tools
- [x] 4.2 Test `get_project_summary` returns project details, tasks, thoughts for seed project
- [x] 4.3 Test `get_recent_activity` returns cross-table activity
- [x] 4.4 Test edge cases: non-existent project, project with no tasks/thoughts, zero-day window
- [x] 4.5 Run full test suite across all packages: 0 failures, 0 skips
