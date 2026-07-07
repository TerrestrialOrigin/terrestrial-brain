## 1. Repo hygiene

- [x] 1.1 Replace stock Node `.gitignore` with a curated repo-scoped one (per design D5); verify with `git status --ignored` that no tracked file becomes ignored and no needed file becomes tracked
- [x] 1.2 Remove the orphan untracked `tests/node_modules/` directory
- [x] 1.3 Delete the tracked `Planning/Done/` historical planning docs (user-approved)
- [x] 1.4 Remove the two stale flat OpenSpec spec files (`openspec/specs/extractor-pipeline.md`, `openspec/specs/task-extractor.md`); confirm the canonical `<name>/spec.md` entries remain and `openspec list` still passes

## 2. Schema cleanup migration

- [x] 2.1 Add a new append-only migration (`supabase/migrations/<ts>_schema_cleanup.sql`): backfill NULL `created_at`/`updated_at` via `coalesce(..., now())` on `thoughts`/`projects`/`tasks`, then `ALTER COLUMN ... SET NOT NULL` on all six columns
- [x] 2.2 In the same migration: backfill legacy `metadata.references.project_id` (string) into `metadata.references.projects` (array, unioned + de-duplicated with any existing array) and drop the legacy key; ensure the statement only matches rows still carrying `project_id` (idempotent / re-runnable)
- [x] 2.3 Apply the migration to the running local stack (`supabase migration up` or `db reset`) and confirm it succeeds

## 3. Canonical match_thoughts + conventions docs

- [x] 3.1 Create `supabase/schemas/match_thoughts.sql` mirroring the current full `create or replace function match_thoughts(...)` from the latest-sorting migration (reference copy, header comment marking it as always-latest, migrations remain executable source)
- [x] 3.2 Document in `docs/upgrade.md`: the `match_thoughts` canonical-file convention (new migration re-creates in full AND update the reference file) and the go-forward index-naming convention (existing indexes not renamed)

## 4. Code & config simplification

- [x] 4.1 Simplify `getProjectRefs` handling in tests so consumers no longer fabricate the dual format; keep one focused unit test proving the reader still tolerates a legacy `project_id`-only row (design D1)
- [x] 4.2 Trim `.vscode/settings.json` `deno.unstable` to `["bare-node-builtins"]`; verify `deno check` on the functions still passes
- [x] 4.3 Add a `scripts/*.sh` reference (validate/deploy/setup scripts) to the README setup/deploy section

## 5. Testing & Verification

- [x] 5.1 Add/adjust a migration-level test (or integration assertion) covering the three reference shapes (legacy-only → normalized, array-only → preserved, both → unioned de-duped) and the timestamp NOT NULL invariant
- [x] 5.2 Run the full Deno suite `TB_AI_PROVIDER=fake deno task test` — zero failures, zero skips
- [x] 5.3 Run `cd obsidian-plugin && npm test && npm run build` — vitest green, build green
- [x] 5.4 Run `deno lint` + `deno fmt --check`, `npm run validate` if present; confirm `docs/fresh-install.md` walkthrough still applies (fresh `supabase db reset` succeeds with the new migration)
- [x] 5.5 `/opsx:verify` then `/opsx:archive`; check off Step 28 in `codeEval/Fable20260704-fix-plan.md`
