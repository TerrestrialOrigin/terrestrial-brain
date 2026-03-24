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
npx supabase functions deploy ingest-thought --project-ref <your-project-ref>
```

This replaces the function code. It does not affect secrets or data.

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
