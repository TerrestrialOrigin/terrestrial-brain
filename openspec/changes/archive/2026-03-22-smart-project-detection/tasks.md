## 1. Improve Conventional Path Detection

- [x] 1.1 Rewrite `extractProjectFolderName` → `extractProjectFromConventionalPath` with case-insensitive, any-depth regex (`/(?:^|\/)projects\/([^/]+)\//i`)
- [x] 1.2 Update `ProjectExtractor.extract()` to call the renamed function

## 2. Add LLM Path Analysis Signal

- [x] 2.1 Add `pathContainsProjectKeyword(referenceId)` helper — returns true if any path segment or filename contains "project" (case-insensitive)
- [x] 2.2 Add `extractProjectNameFromPath(referenceId)` — LLM call that takes a vault-relative path and returns `{ isProject: boolean, projectName: string | null }`. Prompt must distinguish "Rabbit Hutch Project" (a project) from "Project Planning notes" (not a project).
- [x] 2.3 Integrate into `ProjectExtractor.extract()` as Signal 1b: after conventional path fails and before heading match, if `pathContainsProjectKeyword` returns true, call `extractProjectNameFromPath`. If a project name is returned, match or auto-create.

## 3. Testing & Verification

- [x] 3.1 Write unit tests for `extractProjectFromConventionalPath` — root-level, capitalized, nested, deeply nested, no match, empty name
- [x] 3.2 Write unit tests for `pathContainsProjectKeyword` — positive cases (folder, filename), negative cases (no keyword)
- [x] 3.3 Write unit tests for `extractProjectNameFromPath` — mock LLM response, test "is a project" case, "not a project" case, LLM failure case
- [x] 3.4 Run all tests — zero failures, zero skips
