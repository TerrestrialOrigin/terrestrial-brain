## Context

SQL-3, REPO-1, TOOL-10 — unbounded reads reachable from tools. The repo already has the pattern to follow: `listIncompleteUnarchived` fetches `limit + 1` and the handler reports truncation; `constants.ts` centralizes named limits (`MAX_QUERY_LIMIT=100`, `DEFAULT_LIST_LIMIT=20`, `DEFAULT_GROUPED_TASK_LIMIT`, `MAX_GROUPED_TASK_LIMIT`). This change extends that pattern to the paths that still lack it.

## Goals / Non-Goals

**Goals:** every tool-reachable list/RPC is explicitly bounded; any truncation is explicit in the response and logged, never silent. **Non-Goals:** structural refactors (Steps 27+); changing what data the queries return beyond the cap.

## Decisions

**D1 — Reuse the `limit + 1` probe + named constants everywhere.** Repositories fetch `limit + 1`; the handler/formatter slices to `limit` and appends a truncation marker. New constants: `RECENT_ACTIVITY_SECTION_LIMIT = 50` (per `get_recent_activity` section), `LIST_ACTIVE_HARD_CAP = 1000` (extractor seed), `PENDING_METADATA_LIMIT = 200` (RPC default), `MAX_RECENT_ACTIVITY_DAYS = 366` (days schema max). `list_people`/`list_projects` default to `DEFAULT_LIST_LIMIT` (20), max `MAX_QUERY_LIMIT` (100), matching `list_tasks`.

**D2 — `get_recent_activity` truncation is per-section.** Each `*Since` repo method caps at `RECENT_ACTIVITY_SECTION_LIMIT + 1`; `formatRecentActivity` slices each section to the limit and renders `## <Section> (50+)` when the extra row is present. `days` gets `.max(MAX_RECENT_ACTIVITY_DAYS)` so a huge window can't defeat the section caps by widening `since`.

**D3 — SQL-3 recreates the RPC with a `max_rows` parameter.** Adding a parameter changes the signature, so `drop function if exists public.get_pending_ai_output_metadata();` then `create or replace … (max_rows integer default 200) … limit greatest(max_rows, 1)`; restate the explicit `revoke … from public, anon, authenticated; grant execute … to service_role;`. The edge `listPendingMetadata` passes `PENDING_METADATA_LIMIT` and logs `console.warn` when exactly `max_rows` rows come back (possible truncation). `listPending` (non-metadata) also gains a `limit + 1` cap.

**D4 — `listActive` keeps its whole-set intent but bounded.** The extractor seed is arguably whole-table by design; it gets `.limit(LIST_ACTIVE_HARD_CAP)` and logs a truncation warning if the cap is hit, converting a silent full scan into an explicit, logged bound (the finding's requirement).

### User error scenarios
- **`days: 36500`** → clamped by `.max(MAX_RECENT_ACTIVITY_DAYS)`; sections still bounded, so no full-table pull.
- **`limit: 0` / negative / > 100** on `list_*` → zod `.min(1).max(MAX_QUERY_LIMIT)` rejects/bounds at the schema.
- **Exactly `limit` rows exist** → the `limit + 1` probe distinguishes "exactly full" from "more exist," so truncation is reported only when a genuine extra row is present (no false "(more)" at the boundary).
- **Pending metadata exceeds 200** → returns 200 and logs a truncation warning instead of silently dropping newer rows at PostgREST's 1000 cap.

### Security analysis
- Bounding reduces resource-exhaustion surface (a wide `get_recent_activity` or huge `list_*` can no longer stream an entire personal-data table into the response). No new inputs beyond bounded integers validated at the schema. No privilege change. No PII exposure change (same columns, fewer rows).

### Test Strategy
- **Unit (fakes / pure formatters):** each `*Since` section formatter with `limit + 1` rows → truncation marker present, sliced to `limit`; `reconcile_tasks` with `limit + 1` open tasks → "more exist" note; `list_people`/`list_projects` render with truncation when capped; `days`/`limit` schema bounds. GATE 2b: removing a cap reddens the truncation test.
- **Integration (real DB, reset stack):** `get_pending_ai_output_metadata(max_rows)` returns at most `max_rows`; seed `limit + 1` rows and assert the cap + logged truncation for representative repositories.
- Mock-boundary: unit tests fake the repo seam; integration tests hit the real DB with no mocks on the path.

## Risks / Trade-offs

- **[Truncation logic sprinkled across many formatters]** → Centralize the "slice + marker" in a tiny helper reused by each section, so the rule is written once (Rule of Three) rather than copied per section.
- **[Section cap of 50 hides items in a very active window]** → It is explicit (`(50+)`) and logged, and the tool guidance already tells the caller to narrow; correct per "any cap is explicit and logged."
- **[Recreating the RPC changes its signature]** → Callers pass the new bounded arg; the old no-arg form is dropped in the same migration so no stale overload lingers.
