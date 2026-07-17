## 1. Failing tests first (RED)

- [x] 1.1 `tests/unit/archive-project-cascade.test.ts`: failed child lookup and failed task lookup each abort with no archive writes; tasks archived before projects; cyclic graph terminates; `wouldCreateProjectCycle` self/descendant/unrelated cases.
- [x] 1.2 Confirm RED (intermediate swallowed errors + archived projects-first): error-channel + order tests fail.
- [x] 1.3 `tests/integration/projects.test.ts`: `update_project` rejects a cycle-creating `parent_id` (via `callToolRaw`).

## 2. Fix (GREEN)

- [x] 2.1 `archiveProjectCascade`: check both read error channels (abort before any write); reorder to tasks-first, projects-last; visited-set BFS.
- [x] 2.2 `wouldCreateProjectCycle`: ancestor-walk with visited guard.
- [x] 2.3 Wire `archive_project` to `archiveProjectCascade` and `update_project` to `wouldCreateProjectCycle`.

## 3. Testing & Verification

- [x] 3.1 GATE 2b: error-channel + order tests RED before the fix.
- [x] 3.2 Full `deno task test` on a reset stack green; `deno check`, lint, fmt clean.
- [x] 3.3 Validate + archive; check off Step 6 in the plan; commit.
