# Upgrade — Deploy Changes Without Wiping Data

Push new migrations and updated edge functions to an existing Supabase instance while preserving all data.

## Prerequisites

- Your local project is linked to the remote instance. If not:
  ```bash
  npx supabase link --project-ref <your-project-ref>
  ```

## Step 1: Push new migrations

This only applies migrations that haven't been run on the remote yet. It will NOT re-run old migrations or touch existing data.

```bash
npx supabase db push --linked
```

The CLI tracks which migrations have already been applied (via the `supabase_migrations.schema_migrations` table in the remote database). Only new files in `supabase/migrations/` are executed.

> **Important:** Never rename, edit, or delete a migration file that has already been pushed to production. Always create a new migration file for changes.

## Step 2: Deploy updated edge functions

Redeploy any functions that have changed:

```bash
npx supabase functions deploy terrestrial-brain-mcp --project-ref <your-project-ref>
```

This replaces the function code. It does not affect secrets or data.

> **One-time cleanup (Slack integration removal):** If your instance was set up before the Slack integration was removed, delete the retired function and its secrets:
>
> ```bash
> npx supabase functions delete ingest-thought --project-ref <your-project-ref>
> npx supabase secrets unset SLACK_BOT_TOKEN SLACK_CAPTURE_CHANNEL --project-ref <your-project-ref>
> ```
>
> Optionally deactivate or delete the Slack app in your Slack workspace as well.

> **Breaking change (2026-07-10) — auth header renamed `x-brain-key` → `x-tb-key`:**
> The edge function now reads the access key **only** from the `x-tb-key` request
> header; the old `x-brain-key` header is no longer accepted (hard cut, no
> transitional dual-acceptance). Upgrade the **edge function and the Obsidian
> plugin together** so both send/expect the new header, and keep the same
> `MCP_ACCESS_KEY`. Any other MCP client that set a custom `x-brain-key` header must
> switch it to `x-tb-key`. If a client genuinely cannot set custom headers, the
> deprecated `?key=` query-parameter fallback still works as a stop-gap.

## Step 3: Set any new secrets (if needed)

If the update introduces new environment variables, add them:

```bash
npx supabase secrets set NEW_VAR=value --project-ref <your-project-ref>
```

Existing secrets are not affected. You can list current secrets with:

```bash
npx supabase secrets list --project-ref <your-project-ref>
```

## Step 4: Verify

1. Check the Supabase dashboard to confirm new tables/columns exist
2. Confirm edge functions are active and returning expected responses
3. Spot-check that existing data is intact

## Writing Safe Migrations

When adding new migrations, follow these rules to avoid data loss:

- **Add columns as nullable or with defaults.** Never add a `NOT NULL` column without a default to a table that has data.
- **Use `CREATE TABLE IF NOT EXISTS`** and **`CREATE INDEX IF NOT EXISTS`** when appropriate.
- **Never use `DROP TABLE`** unless you genuinely want to delete that table and all its data. Use `ALTER TABLE` instead.
- **Use `CREATE OR REPLACE FUNCTION`** for function updates so the old version is replaced cleanly.
- **Test locally first.** Run `npx supabase db reset` locally to verify all migrations apply cleanly before pushing to production.

## Conventions

These conventions keep the append-only migration history readable as the schema grows.

### `search_thoughts_by_embedding` canonical reference file

Because migrations are append-only, a function like `search_thoughts_by_embedding` is re-created in full by whichever migration last changed it — so its live definition is otherwise only findable by diffing migrations. To make it discoverable from one place, [`supabase/schemas/search_thoughts_by_embedding.sql`](../supabase/schemas/search_thoughts_by_embedding.sql) holds an always-latest **reference copy**.

That file is **not** part of the executable apply path (the migrations remain the single source of truth). Keep it in sync by rule:

> **When you change `search_thoughts_by_embedding`:** add a new migration that re-creates it in full (`create or replace function ...`), **and** update `supabase/schemas/search_thoughts_by_embedding.sql` to match, updating its "Last synced with" comment to the new migration filename.

Apply the same pattern to any other function that accumulates a re-paste history across migrations.

### Index naming

Name new indexes `idx_<table>_<column>[_<column>...]` (e.g. `idx_thoughts_archived_at`, `idx_function_call_logs_function_name_called_at`). This is the convention the newer migrations already follow.

- **Do not rename existing indexes** to match — some older ones use the legacy `<table>_<column>_idx` order, and renaming them would be a churny, no-value migration. The convention applies going forward only.
- Create indexes with `CREATE INDEX IF NOT EXISTS` so a re-run is safe.

## Quick Reference

| What you want to do | Command |
|---|---|
| Push new migrations only | `npx supabase db push --linked` |
| Deploy a function | `npx supabase functions deploy <name> --project-ref <ref>` |
| Add a secret | `npx supabase secrets set KEY=value --project-ref <ref>` |
| List secrets | `npx supabase secrets list --project-ref <ref>` |
| Check remote migration status | `npx supabase migration list --linked` |
| Test migrations locally | `npx supabase db reset` |

## Rollback

If a migration causes problems in production:

1. **Do NOT delete the migration file.** The remote database has already recorded it as applied.
2. Create a new migration that reverses the change:
   ```bash
   npx supabase migration new rollback_description
   ```
3. Write the reversal SQL (e.g., `DROP COLUMN`, `DROP INDEX`, restore old function definition).
4. Push the rollback migration:
   ```bash
   npx supabase db push --linked
   ```
