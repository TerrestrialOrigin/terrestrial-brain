## 1. Failing tests first (bug-fix rule — write RED before any implementation)

- [x] 1.1 Add a unit test (`tests/unit/records-returned-logging.test.ts`) using the fake `FunctionCallLogger` seam: a handler returning `textResult("…", { recordsReturned: 3, returnedIds: ["a","b","c"] })` MUST log `records_returned = 3` and `returned_ids = ["a","b","c"]`. Run it and confirm it fails RED against current code (which logs `content.length = 1`).
- [x] 1.2 Add unit assertions in the same file: empty-meta (`recordsReturned: 0`) → logs 0; a thrown handler → logs `records_returned = 0` with `error_details` set; an `errorResult` handler → logs 0; a bare `textResult` (no meta) → logs 1 (regression guard); the returned client envelope has no `meta` key.
- [x] 1.3 Add an integration test (`tests/integration/records_returned.test.ts`, real local stack, `TB_AI_PROVIDER=fake`): capture N unique thoughts, `search_thoughts` for them, read the latest `search_thoughts` `function_call_logs` row and assert `records_returned = N` and `returned_ids` has N ids; a no-match search logs `records_returned = 0`; `get_thought_by_id` logs `records_returned = 1` and `returned_ids = [id]`. Confirm the count assertions fail RED against current code.

## 2. Database migration + types

- [x] 2.1 Add append-only migration `supabase/migrations/20260710000002_function_call_logs_returned_ids.sql`: `alter table function_call_logs add column returned_ids jsonb;` (nullable, no default, no backfill).
- [x] 2.2 Restart/apply the local stack and regenerate `database.types.ts` via `deno task gen:types`.

## 3. Envelope seam (mcp-response.ts)

- [x] 3.1 Add `ResultMeta` (`{ recordsReturned?: number; returnedIds?: string[] }`) and an optional `meta?: ResultMeta` field to `McpToolResult`.
- [x] 3.2 Extend `textResult(text, meta?)` to attach `meta` ONLY when provided (bare `textResult()` must stay deep-equal-stable — no `meta: undefined` key).

## 4. Logging decorator + logger (logger.ts)

- [x] 4.1 Add an optional trailing `returnedIds?: string[] | null` parameter to `FunctionCallLogger.logResult` (interface + `createFunctionCallLogger` impl), writing it to the `returned_ids` column when present.
- [x] 4.2 In `withMcpLogging`: compute `records_returned = isError ? 0 : (result.meta?.recordsReturned ?? contentEntries.length)` and `returnedIds = isError ? null : (result.meta?.returnedIds ?? null)`; pass both to `logResult`.
- [x] 4.3 Strip `meta` from the result before returning it to the client (`const { meta: _m, ...clientResult } = result; return clientResult;`).

## 5. Instrument row-returning handlers (per design D4)

- [x] 5.1 `tools/thoughts.ts`: `search_thoughts` and `list_thoughts` set `meta.recordsReturned = data.length` and `meta.returnedIds = thoughtIds` on the success branch, and `recordsReturned: 0` on the empty branch.
- [x] 5.2 `tools/thoughts.ts`: `get_thought_by_id` sets `recordsReturned: 1, returnedIds: [data.id]` when found, and `recordsReturned: 0` on the not-found branches.
- [x] 5.3 `tools/tasks.ts` (`get_tasks`), `tools/people.ts` (`list_people`, `get_person`), `tools/projects.ts` (`list_projects`, `get_project`), `tools/documents.ts` (`list_documents`, `get_document`): set `meta.recordsReturned` to the real row count (0 on empty; 1/0 for single-record gets). No `returnedIds` for non-thought reads.

## 6. Gates & verification

- [x] 6.1 Re-run the unit + integration tests from group 1 — now GREEN. GATE 2b: revert the decorator to `contentEntries.length`, confirm the `logs 3` and `= N` assertions redden, then restore.
- [x] 6.2 Full backend suite green: `deno task test` (local stack via `npx supabase start`, `TB_AI_PROVIDER=fake`), zero failures, zero skips. Show the summary line.
- [x] 6.3 Plugin unaffected but re-verify: `cd obsidian-plugin && npm test && npm run build` — green.
- [x] 6.4 `deno task lint` / `fmt --check` clean on touched files (no `any`, no lint suppressions added).
- [x] 6.5 Mark Step 2b complete in `codeEval/Fable20260710-NewFeaturePlan.md`; run `/opsx:verify` then `/opsx:archive`.
