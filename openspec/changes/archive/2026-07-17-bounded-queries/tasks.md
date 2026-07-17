## 1. Constants

- [x] 1.1 Add to `constants.ts`: `RECENT_ACTIVITY_SECTION_LIMIT = 50`, `LIST_ACTIVE_HARD_CAP = 1000`, `PENDING_METADATA_LIMIT = 200`, `MAX_RECENT_ACTIVITY_DAYS = 366` (each with a doc comment).

## 2. Migration (SQL-3, append-only)

- [x] 2.1 New `supabase/migrations/20260717000004_pending_ai_output_metadata_limit.sql`: `drop function if exists public.get_pending_ai_output_metadata();` then recreate with `(max_rows integer default 200)` and `limit greatest(max_rows, 1)`; restate revoke/grant execute; `set search_path = public, pg_temp`. Update the `supabase/schemas/` mirror if one exists.

## 3. Repositories (REPO-1)

- [x] 3.1 `PersonListFilters`/`ProjectListFilters` += `limit: number`; apply `.limit(filters.limit + 1)` in both `list` impls.
- [x] 3.2 Cap the seven `*Since` methods + `listOpenTasksForProject` at `RECENT_ACTIVITY_SECTION_LIMIT + 1` (add `.limit(...)`).
- [x] 3.3 `listPending`: `.limit(PENDING_METADATA_LIMIT + 1)` (or a named cap); `listPendingMetadata`: pass `PENDING_METADATA_LIMIT` to the RPC and `console.warn` when exactly the cap returns.
- [x] 3.4 `listActive` (person + project): `.limit(LIST_ACTIVE_HARD_CAP)` and `console.warn` truncation if the cap is hit.

## 4. Tools (TOOL-10)

- [x] 4.1 `list_projects`/`list_people`: add `limit` zod input (`.int().min(1).max(MAX_QUERY_LIMIT).default(DEFAULT_LIST_LIMIT)`); thread into the repo; render an explicit truncation notice when the `limit + 1` probe indicates more.
- [x] 4.2 `get_recent_activity`: give `days` `.max(MAX_RECENT_ACTIVITY_DAYS)`; slice each section to `RECENT_ACTIVITY_SECTION_LIMIT` in `formatRecentActivity` and render `## <Section> (50+)` when the extra probe row is present (one shared slice+marker helper).
- [x] 4.3 `reconcile_tasks`: replace `limit: 100` with a `limit + 1` probe; append a "more exist — narrow by project" note when capped.

## 5. Tests (fail RED first where behavioral)

- [x] 5.1 Unit: section formatter with `limit + 1` rows → truncation marker + sliced output; without the extra row → no marker (boundary).
- [x] 5.2 Unit: `reconcile_tasks` "more exist" note when over cap.
- [x] 5.3 Unit/schema: `days` above max and `limit` out of range are bounded/rejected.
- [x] 5.4 Integration: `get_pending_ai_output_metadata(max_rows)` returns at most `max_rows` (seed `max_rows + 1`); a representative bounded repo caps at `limit`.
- [x] 5.5 GATE 2b: removing a cap / truncation marker reddens the relevant test.

## 6. Gates

- [x] 6.1 `npx supabase db reset`; `npx supabase test db` (green); `deno task test` (green, 0 skips).
- [x] 6.2 `cd obsidian-plugin && npm test && npm run build` (green).
- [x] 6.3 `scripts/validate-all.sh` end-to-end — green.

## 7. Finalize

- [x] 7.1 `/opsx:verify`, sync delta specs, `/opsx:archive`.
- [x] 7.2 Check off Step 12 in `codeEval/Fable20260717RemediationPlan.md`.
- [x] 7.3 Commit on branch, merge into develop, push.
