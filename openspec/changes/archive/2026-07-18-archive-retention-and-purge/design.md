## Context

SQL-9. Verified: exactly four public tables carry `archived_at` — `thoughts`, `projects`, `tasks`, `people`. Inter-table FKs among them are all `SET NULL`, so deleting an archived row never cascade-deletes another archivable row. The ONE cascade is `documents.project_id → projects ON DELETE CASCADE`: purging an archived project also deletes its documents (which have no `archived_at`). GDPR requires storage-limitation (no fixed number); a 365-day window for archived rows is defensible and mirrors the existing `function_call_logs` 90-day purge. The user chose: expose the manual purge as BOTH a CLI script and an MCP tool, with a confirm + dry-run guard.

## Goals / Non-Goals

**Goals:** a bounded retention cron (1 year) + an explicit, confirmed, SQL-free erasure pathway (RPC + CLI + MCP tool) over the four archivable tables. **Non-Goals:** archiving documents/snapshots; erasing non-archived data.

## Decisions

**D1 — Two RPCs: count (dry-run) and purge, over an allowlist.** `count_archived_rows` and `purge_archived_rows(target_table text default null, archived_on_or_before date default null)`, both `SECURITY DEFINER`, `set search_path = public, pg_temp`, service_role-only EXECUTE. `target_table`, if given, MUST be one of the allowlist (`tasks, thoughts, people, projects`) — an unknown table raises. Dynamic `delete from %I` is safe because the identifier comes only from the validated allowlist. The date filter is `archived_at is not null and ($1 is null or archived_at < $1)` where `$1 = (archived_on_or_before + 1)::timestamptz`, so "on that date or older" includes the whole given day and a null date means "all archived".

**D2 — Purge order + cascade honesty.** Delete order `tasks, thoughts, people, projects` (projects last). The projects delete cascades to `documents`; because those documents have no `archived_at`, that collateral is surfaced explicitly: both RPCs report a `documents (via project cascade)` count for the projects in scope, so the dry-run shows it BEFORE anyone confirms. Nothing is deleted silently.

**D3 — Confirm + dry-run guard at every entry point.**
- CLI `scripts/purge-archived.sh`: runs `count_archived_rows` first and prints the table; the delete-everything case (no args) requires typing `PURGE`; a targeted `table date` purge requires `y/N`; `--yes` bypasses for automation. `--local`/`--linked` selects the DB (default `--linked`). Table arg validated against the allowlist before any query.
- MCP tool `purge_archived({ table?, on_or_before?, confirm? })`: returns the dry-run counts unless `confirm === true`; only then calls the purge RPC. So a single tool call can never delete without an explicit confirm flag.

**D4 — Retention cron, best-effort.** `cron.schedule('purge-archived-rows-yearly', '0 4 * * *', 'select public.purge_archived_rows(null, (current_date - 365));')`, wrapped in the same exception handler the retention migration uses (so local/CI without pg_cron still apply). Step 13's prod-script verification pattern already fails loud if a retention job is missing — extendable later; this change adds the job.

**D5 — Seam.** A narrow `ArchiveMaintenanceRepository` (`countArchived`, `purgeArchived`) behind the repository pattern, wired at the composition root; the tool depends on the interface so it is unit-testable with a fake.

### User error scenarios
- **Unknown table name** (CLI or tool): validated against the allowlist → clear error, nothing deleted.
- **`purge_archived` called without `confirm`**: returns the dry-run counts only; no deletion.
- **Operator runs the no-arg CLI purge by mistake**: the `PURGE` prompt (and the printed per-table + cascade counts) stop an accidental wipe.
- **Malformed date**: the DB rejects a non-date `archived_on_or_before`; the CLI/tool surface the error.
- **Runs twice**: purge is idempotent — a second run finds fewer/no matching archived rows and deletes 0.

### Security analysis
- **Threat: AI-triggered mass erasure via prompt injection.** Mitigated by the tool's `confirm` gate (dry-run by default) and by the CLI being the primary operator path; the destructive capability is service_role-only and never reachable by anon/authenticated (asserted in the pgTAP denial suite).
- **Threat: SQL injection via `target_table`.** Closed by the allowlist check before any `%I` interpolation.
- **Threat: unintended collateral deletion** (documents cascade). Surfaced in the dry-run, not hidden.
- **GDPR:** provides the storage-limitation control (365-day purge) and a named erasure runbook (the CLI), replacing hand-written SQL. Positive privacy impact.

### Test Strategy
- **pgTAP denial:** add `count_archived_rows` and `purge_archived_rows` to `rls_denial.test.sql` (anon + authenticated EXECUTE denied).
- **Integration (real DB, reset stack):** seed archived + non-archived rows across the four tables with varied `archived_at` dates; assert `count_archived_rows` matches; `purge_archived_rows('people', <date>)` deletes only matching archived people and leaves non-archived + newer-archived + other tables intact; a full purge removes all archived rows; assert the documents-cascade count is reported and that purging an archived project removes its documents. GATE 2b: dropping the date filter over-deletes (reddens).
- **Unit (fake repo):** `purge_archived` returns counts without deleting when `confirm` is absent, and calls `purgeArchived` only when `confirm === true`.
- **Static (`tests/unit/purge-archived-script.test.ts`):** the CLI runs `count_archived_rows` first, requires `PURGE` for the no-arg case, honors `--yes`, uses `npx supabase`, and validates the table against the allowlist.

## Risks / Trade-offs

- **[Projects→documents cascade deletes live documents]** → Surfaced in every dry-run; treated as part of erasing that project's data. A future change could add `archived_at` to documents; out of scope here.
- **[MCP tool exposes a destructive op to the AI]** → Gated behind `confirm: true` + service_role; the CLI is the recommended operator path. Chosen because the user asked for both.
- **[Dynamic SQL]** → Constrained to a fixed allowlist; no user text reaches the identifier.
