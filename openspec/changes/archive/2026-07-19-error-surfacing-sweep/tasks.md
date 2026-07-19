# Tasks — error-surfacing-sweep

## 1. Repository envelope (REPO-7)

- [x] 1.1 Add RED integration assertions: `countOpenByProject`/`countOpenByAssignee` return `data: null` when the query errors, `data: 0` on empty success (extend nearest existing repository integration suite)
- [x] 1.2 Fix both count methods in `supabase-task-repository.ts` to branch on `error` (`data: null` with error, `count ?? 0` otherwise); confirm tests green

## 2. Entity-detail unavailable markers (TOOL-4)

- [x] 2.1 Write RED unit tests (fake repositories): failed `countOpenByProject`, `countOpenByAssignee`, `findName`, `listChildrenBasic` → `? (lookup failed)` markers; failed `listChildParentIds` → trailing unavailable note; zero-success control renders `0` with no marker
- [x] 2.2 Implement error-channel checks + markers + `console.error` context labels in `get_project`, `get_person`, `list_projects`; confirm green

## 3. touchRetrieved logging (TOOL-5)

- [x] 3.1 Write RED unit test: fake `touchRetrieved` errors → read still succeeds, `console.error` called with site label
- [x] 3.2 Extract shared `touchRetrievedLogged` helper; use it at all three call sites; confirm green

## 4. Pipeline-throw warnings (TOOL-12)

- [x] 4.1 Write RED unit tests: throwing pipeline in `capture_thought` and `write_document` → confirmation contains extraction-failed warning
- [x] 4.2 Set the existing warning variables in both catch blocks (mirror `update_document`); confirm green; GATE 2b mutation check on the assignment

## 5. allSettled reason logging (TOOL-13)

- [x] 5.1 Write RED unit tests: one failing op in `executeReconciliationPlan` and one failing insert in `freshIngest` → reason logged via `console.error`, counts unchanged
- [x] 5.2 Log rejected reasons with site labels at both sites; confirm green

## 6. Testing & Verification

- [x] 6.1 `npx supabase db reset` then full `deno task test` — zero failures, zero skips
- [x] 6.2 `cd obsidian-plugin && npm test && npm run build` — green
- [x] 6.3 `npm run validate` / `scripts/validate-all.sh` — green
- [x] 6.4 Walk delta-spec scenarios against implementation; update docs if needed
