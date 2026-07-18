## Why

The MCP surface only archives — `archived_at` is stamped and rows persist indefinitely, including third-party personal data (`people.name`/`email`, thought content about named people). There is no defined erasure/retention pathway (SQL-9), in tension with GDPR storage-limitation, and a data-subject erasure request has no supported method short of hand-written SQL.

## What Changes

- New append-only migration adding two service-role-only RPCs over the four archivable tables (`thoughts`, `projects`, `tasks`, `people`):
  - `count_archived_rows(target_table, archived_on_or_before)` — a dry-run: per-table counts of archived rows matching the filter (and the documents that a project purge would cascade-delete).
  - `purge_archived_rows(target_table, archived_on_or_before)` — hard-deletes those rows and returns per-table deleted counts.
  - No filter → all archived rows in all four tables; `target_table` + `archived_on_or_before` (a date) → only that table's rows archived on that date or earlier. `target_table` is validated against an allowlist.
- A **365-day retention cron** (`purge-archived-rows-yearly`) that calls `purge_archived_rows(null, current_date - 365)` daily, mirroring the `function_call_logs` purge (best-effort pg_cron schedule).
- An MCP tool `purge_archived` (dry-run by default; `confirm: true` to delete) so the AI/operator can purge without writing SQL.
- A CLI script `scripts/purge-archived.sh [--local|--linked] [table] [on_or_before]` that prints the dry-run counts and requires explicit confirmation (type `PURGE` for the delete-everything case, or `--yes`) before purging.

## Capabilities

### New Capabilities
- `archive-retention`: bounded retention + an explicit, confirmed erasure pathway for archived personal data across the archivable tables.

### Modified Capabilities
- `database-access-control`: the two new RPCs SHALL be executable only by `service_role` (anon/authenticated denied), asserted in the pgTAP denial suite.

## Non-goals

- Adding `archived_at` to `documents`/`note_snapshots`/`ai_output` (schema change beyond scope; `function_call_logs` already has its own retention).
- Auto-erasing non-archived data.

## Impact

- `supabase/migrations/` (one new file); a new `ArchiveMaintenanceRepository` seam + Supabase impl; a `purge_archived` MCP tool wired at the composition root; `scripts/purge-archived.sh` (new); pgTAP denial coverage for the new RPCs; integration + unit + static tests.
- Affected spec files: `openspec/specs/archive-retention/spec.md` (new), `openspec/specs/database-access-control/spec.md`.
