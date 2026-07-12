## Context

The TB MCP server exposes task tools in `tools/tasks.ts`, each wrapped in `withMcpLogging` and returning a formatted markdown text body. Reads go through the `TaskRepository` seam (`repositories/task-repository.ts` + `supabase-task-repository.ts`); project-name resolution goes through the query/name-resolution repositories already used by `get_project_summary` and `list_tasks` (see `tools/queries.ts` name-map helpers). The `tasks` table carries `status` (`open|in_progress|done|deferred`), `project_id` (nullable), `due_by` (nullable), `archived_at` (nullable), `created_at`, and `content`.

No existing tool aggregates incomplete tasks across all projects. `list_tasks` is single-project + single-status with a default limit of 20; `get_project_summary` is per-project. This change adds one read-only tool, `list_open_tasks_by_project`, plus a bounded repository method to back it.

## Goals / Non-Goals

**Goals:**
- One call returns every incomplete (`status != done`), unarchived task across the whole brain, grouped by project.
- Tasks with `project_id = null` land in a dedicated "(No project)" group, rendered last, never dropped.
- Deterministic ordering: projects alphabetical by name; tasks overdue-first, then due-date ascending (undated last), then `created_at` ascending.
- The query is bounded by an explicit cap; truncation is reported in the body and logged. No unbounded fetch-all.
- Real telemetry: handler supplies `recordsReturned` (total tasks emitted) and `returnedIds` to the logging layer.

**Non-Goals:**
- Sub-project hierarchy/nesting (flat groups only — see proposal Non-goals).
- Any mutation of tasks.
- Pagination cursors, assignee/date-window/free-text filtering (that stays in `list_tasks`).

## Decisions

### D1 — Where the tool lives and its shape
Register `list_open_tasks_by_project` in `tools/tasks.ts` alongside `list_tasks`, using `withMcpLogging`, a Zod `inputSchema`, and a pure formatter that renders a markdown text body. Reuse the existing single-task rendering (status icon, `ID: … | Status: …`, overdue marker) from `list_tasks` so a task row looks identical wherever it appears — extract the per-task line renderer into a shared pure helper rather than copying it (Rule of Three: this is the 2nd caller, so extract now).

*Alternative considered:* a brand-new `tools/queries.ts` entry. Rejected — the logic is task-centric and shares rendering with `list_tasks`; co-locating keeps the shared formatter private to one module.

### D2 — Repository method (the bounded query)
Add to `TaskRepository`:
```
listIncompleteUnarchived(filters: { limit: number; includeDeferred: boolean })
  : Promise<RepoResult<TaskListRow[]>>
```
Implemented in `supabase-task-repository.ts` as a single query: `archived_at is null`, `status != 'done'` (and `status != 'deferred'` when `includeDeferred` is false), ordered server-side, `.limit(limit + 1)` so the handler can detect truncation (if `limit + 1` rows come back, the set was capped). Grouping and project-name resolution stay in the handler — the repository returns a flat, ordered row set (mirrors how `list` already works).

*Alternative considered:* a SQL-side `GROUP BY`/JSON aggregation returning pre-grouped rows. Rejected for MVP — it pushes rendering concerns into SQL, complicates name resolution (project names live in `projects`, resolved via the name-map seam), and the flat-then-group-in-handler pattern matches the rest of the codebase.

*Alternative considered:* reuse `list()` with new optional filters. Rejected — `list()`'s contract is single-project/single-status; overloading it with a "no project filter, multi-status, exclude-done" mode muddies a stable seam. A separate, explicitly-named method is clearer.

### D3 — Grouping, ordering, and the no-project bucket
Handler groups the flat rows by `project_id`. Project display names resolved in one batched lookup via the existing name-resolution seam (no N+1). Group order: real projects alphabetical (case-insensitive) by resolved name; the `null`-project group ("(No project)") always last. Within a group, order is already guaranteed by the repository's server-side `ORDER BY` (overdue/soonest due first via `due_by asc nulls last`, then `created_at asc`); "overdue" is derived at render time (`due_by < now && status != done`) purely for the marker, not for sort re-shuffling.

### D4 — Bounded cap + truncation reporting
`limit` Zod-validated integer, default `500`, min `1`, max `1000`. If the repository signals more rows than `limit` existed (the `limit + 1` probe), the response body ends with an explicit line — e.g. `⚠️ Showing the first 500 tasks; more exist. Narrow with list_tasks.` — and the truncation is logged. Never silently drop rows without saying so.

### D5 — `include_deferred` default
Default `true` so the tool's plain meaning ("all incomplete") holds. Callers wanting only actionable work pass `include_deferred: false` to drop `deferred`. `done` is always excluded (that is what "incomplete" means); archived is always excluded.

### User error scenarios
- **`limit` below 1 / above 1000 / non-integer / non-numeric** → Zod rejects at the boundary with a clear validation error; no query runs. (parse-don't-cast at the door.)
- **`include_deferred` given a non-boolean** → Zod validation error.
- **No incomplete tasks anywhere** → success with an explicit empty-state body ("No open tasks."), NOT an error and NOT a bare empty string — distinguishes "empty" from "broken".
- **All tasks are unassigned** → a single "(No project)" group renders; no crash on the all-null path.
- **A task references a project id whose row was deleted** → name resolution returns no name; that task is grouped under a clearly-labelled "(Unknown project <id>)" group rather than being dropped or crashing.
- **Extra/unknown args passed** → ignored by the Zod schema (no passthrough), tool still runs.

### Security analysis
- **AuthZ:** identical to every other MCP tool — gated by the `x-brain-key` header check at the edge boundary before the handler runs; no new auth surface. To be recorded in `ThreatModel.md` under the tasks tool group.
- **Read-only:** the tool performs a single `SELECT`; it cannot mutate, so no injection-to-mutation or double-run hazard.
- **No unbounded fetch (DoS/perf):** the explicit `limit + 1` cap (max 1000) prevents a caller from forcing an unbounded scan/serialization of the whole table; truncation is logged.
- **No PII leakage in logs:** telemetry records counts and task **ids** only (consistent with existing `returnedIds`), never task content — matches the "never log user content" rule.
- **Parameterized query:** filters are bound through the Supabase client query builder, not string-concatenated SQL.

### API contract
Back-end-only MCP tool; no front-end consumer. The tool signature (name, `limit`, `include_deferred`, grouped markdown body shape, empty-state, truncation line) will be recorded in `docs/api-frontend-guide.md` for completeness and for any future dashboard (New-Feature-Plan Step 17 memory console) that may surface this view.

### Test Strategy
- **Unit** — pure formatter/grouper: given synthetic rows, assert group ordering, no-project-last, unknown-project labelling, within-group order, overdue markers, empty-state body, and truncation line. Uses fakes, no DB.
- **Integration (real stack, no mocks on the tested path)** — seed projects + tasks (mixed statuses, some archived, some `done`, some null-project, some deferred, one orphaned project_id) through the real repository/DB, invoke the real tool handler, and assert the rendered grouping, that `done`/archived are excluded, that `include_deferred` toggles deferred, and that the cap truncates + reports. Follows the lifecycle-rules integration-test pattern under `tests/integration/`.
- **Telemetry assertion** — confirm the `function_call_logs` row records the real `recordsReturned` (total emitted) and populated `returned_ids` (GATE 2b mutation check: deleting the `recordsReturned`/`returnedIds` wiring reddens this).
- No new eval-tagged (LLM) scenarios — the tool is fully deterministic.

## Risks / Trade-offs

- **[Large brains exceed the cap silently misleading the reader]** → Mitigated by D4: truncation is always reported in the body and logged; default 500 is generous for a personal brain and the reader is told to narrow with `list_tasks`.
- **[Flat groups hide sub-project structure]** → Accepted trade-off for MVP (explicit Non-goal); parent name in the header softens it, and nesting can be a follow-up once the memory console (Step 17) needs a tree.
- **[Sharing the per-task renderer with `list_tasks` risks a regression in the existing tool]** → Mitigated by extracting a pure helper covered by the existing `list_tasks` tests plus new unit tests before wiring the new tool (TDD, watch red first).
- **[Batched name resolution N+1 if done naively]** → Mitigated by D3's single batched lookup keyed on the distinct set of non-null project ids.

## Migration Plan

- Purely additive: new tool + new repository method; no schema migration, no data backfill, no change to existing tool behavior.
- Deploy: ship with the edge function; the tool appears in the MCP tool list on next deploy.
- Rollback: remove the tool registration (and method) — no persisted state to unwind.

## Open Questions

- None blocking. Defaults chosen (limit 500/max 1000, `include_deferred: true`, flat groups, alphabetical project order) are reversible and can be tuned after first use without a spec change.
