## 1. Migration (append-only) + validate

- [x] 1.1 New `supabase/migrations/20260718000001_archive_retention_and_purge.sql`: `count_archived_rows` + `purge_archived_rows` (plpgsql, SECURITY DEFINER, `set search_path=public, pg_temp`, allowlist `tasks,thoughts,people,projects`, date filter `($1 is null or archived_at < $1)`, documents-cascade count reported); revoke/grant execute service_role-only.
- [x] 1.2 Best-effort `cron.schedule('purge-archived-rows-yearly', '0 4 * * *', 'select public.purge_archived_rows(null, (current_date - 365));')` wrapped in the pg_cron exception handler (mirror 20260706000002).
- [x] 1.3 `npx supabase db reset`; validate RPC logic directly via psql (targeted, unfiltered, unknown-table, cascade count).

## 2. Repository seam

- [x] 2.1 `repositories/archive-maintenance-repository.ts` interface (`countArchived`, `purgeArchived`) + `supabase-archive-maintenance-repository.ts` impl calling the RPCs.
- [x] 2.2 Wire it at the composition root (index.ts) and into the tool registration.

## 3. MCP tool

- [x] 3.1 `tools/archive.ts` `purge_archived` tool: input `{ table?: enum, on_or_before?: date, confirm?: boolean }`; dry-run counts unless `confirm===true`, then purge; render per-table + cascade counts. Register in createMcpServer.

## 4. CLI script

- [x] 4.1 `scripts/purge-archived.sh [--local|--linked] [table] [on_or_before]`: allowlist-validate table, run count RPC + print, require `PURGE` for the no-arg case / `y-N` for targeted (unless `--yes`), then purge RPC; `npx supabase db query`.

## 5. Tests (RED where behavioral)

- [x] 5.1 pgTAP: add both RPCs to `rls_denial.test.sql` anon/authenticated EXECUTE denial (bump plan count).
- [x] 5.2 Integration: seed archived + non-archived across the 4 tables + varied dates; count matches; targeted purge deletes only matching; unfiltered purge removes all archived; documents cascade reported + removed; non-archived survive. GATE 2b: dropping the date filter over-deletes.
- [x] 5.3 Unit: `purge_archived` tool dry-run (no confirm → no delete) vs confirm (deletes) with a fake repo.
- [x] 5.4 Static: `tests/unit/purge-archived-script.test.ts` (count-first, PURGE guard, --yes, npx, allowlist).

## 6. Gates

- [x] 6.1 `npx supabase db reset`; `npx supabase test db` green; `deno task test` green (0 skips).
- [x] 6.2 plugin test+build; `scripts/validate-all.sh` green.

## 7. Finalize

- [x] 7.1 `/opsx:verify`, sync delta specs (new archive-retention spec + database-access-control), `/opsx:archive`.
- [x] 7.2 Note SQL-9 resolved in the plan checklist.
- [x] 7.3 Commit on branch, merge into develop, push.
