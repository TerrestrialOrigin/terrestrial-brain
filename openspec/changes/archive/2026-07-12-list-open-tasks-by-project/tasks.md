## 1. Repository seam (bounded query)

- [x] 1.1 Add `listIncompleteUnarchived(filters: { limit: number; includeDeferred: boolean }): Promise<RepoResult<TaskListRow[]>>` to the `TaskRepository` interface in `repositories/task-repository.ts`, with a doc comment describing the `status != done`, `archived_at is null`, server-side ordering, and `limit + 1` truncation-probe contract.
- [x] 1.2 Implement it in `repositories/supabase-task-repository.ts`: single `SELECT` with `archived_at is null`, `status != 'done'` (and `status != 'deferred'` when `includeDeferred` is false), `order by due_by asc nulls last, created_at asc`, `.limit(limit + 1)`; surface DB errors through `RepoResult` (never swallow).
- [x] 1.3 Confirm no other repository method or caller needs changing (this is additive).

## 2. Shared per-task renderer

- [x] 2.1 Extract the existing per-task line renderer used by `list_tasks` (status icon, `ID: … | Status: …`, overdue marker, due/created formatting) into a pure shared helper in `tools/tasks.ts` (or a sibling module) — no behavior change to `list_tasks`.
- [x] 2.2 Confirm existing `list_tasks` tests still pass against the extracted helper (regression guard).

## 3. `list_open_tasks_by_project` tool

- [x] 3.1 Add the Zod `inputSchema`: `limit` (int, default 500, min 1, max 1000) and `include_deferred` (boolean, default true); reject unknown/invalid input at the boundary.
- [x] 3.2 Handler calls `listIncompleteUnarchived`, detects truncation via the `limit + 1` probe, and trims to `limit`.
- [x] 3.3 Batch-resolve project names for the distinct non-null `project_id` set via the existing name-resolution seam (no N+1).
- [x] 3.4 Group rows: real projects alphabetical (case-insensitive) by name; unresolved project ids → "(Unknown project <id>)" group; null project → "(No project)" group rendered last.
- [x] 3.5 Pure formatter renders group headings + tasks (via the shared renderer), the empty-state body ("No open tasks."), and the truncation notice line when capped.
- [x] 3.6 Wrap in `withMcpLogging`; supply real `recordsReturned` (total emitted) and `returnedIds` (all emitted task ids) to the logging layer; log truncation.
- [x] 3.7 Register the tool and update any MCP tool-count / tool-list snapshot tests.

## 4. Docs

- [x] 4.1 Record the tool signature (name, `limit`, `include_deferred`, grouped-markdown body, empty-state, truncation line) in `docs/api-frontend-guide.md`.
- [x] 4.2 Add the tool to `ThreatModel.md` under the tasks tool group (read-only, key-gated, bounded — no new auth surface).

## 5. Testing & Verification

- [x] 5.1 **Unit** — formatter/grouper with synthetic rows: group ordering, no-project-last, unknown-project labelling, within-group urgency order, overdue markers, empty-state body, truncation line.
- [x] 5.2 **Integration (real stack, no mocks on tested path)** — seed projects + tasks (mixed statuses incl. `done`/archived/`deferred`/null-project/orphaned-project-id) through the real repo/DB; invoke the real handler; assert grouping, `done`+archived exclusion, `include_deferred` toggle, and cap truncation + reporting.
- [x] 5.3 **Telemetry** — assert the `function_call_logs` row records real `recordsReturned` and populated `returned_ids` (GATE 2b: removing the wiring reddens this).
- [x] 5.4 Write each test to fail RED first for the expected reason before implementing (TDD); confirm mutation check.
- [x] 5.5 Run GATE 1–4: app builds + boots, full cross-package suite green — **0 failures, 0 skips** — paste the summary line.
- [x] 5.6 Update/run `npm run validate` (or the Deno task equivalent) for the new tool.
- [x] 5.7 `/opsx:verify` then `/opsx:archive`.
