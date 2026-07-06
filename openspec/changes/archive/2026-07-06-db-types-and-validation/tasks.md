## 1. Shared helper & schema enum constants

- [x] 1.1 Add `escapeLikePattern(input: string): string` to a shared util module in the function source (escape `\` first, then `%` and `_`); it returns text safe to interpolate into an `ilike`/`like` pattern using the default `\` escape char.
- [x] 1.2 Add exported enum value constants (single source) for task `status` (open/in_progress/done/deferred), thought `type` (observation/task/idea/reference/person_note), project `type` (client/personal/research/internal), person `type` (human/ai), and `reliability` (reliable/less reliable). Cross-check each list against the DB CHECK constraints / column usage in `supabase/migrations/*.sql`; document any value enforced only at the edge.

## 2. Zod schema tightening (tools/*.ts)

- [x] 2.1 `tools/thoughts.ts`: `search_thoughts.limit` → `.min(1).max(100)`; `search_thoughts.reliability` & `list_thoughts.reliability` & `update_thought.reliability` → `z.enum(reliability)`; `list_thoughts.type` → `z.enum(thoughtType)`; `list_thoughts.limit`/`days` → bounded `.max()`; `list_thoughts.project_id`, `thought_stats.project_id`, `update_thought.id`, `capture_thought.project_ids`/`document_ids`, `update_thought.project_ids`/`document_ids` → `.uuid()` (element-wise for arrays).
- [x] 2.2 `tools/documents.ts`: `write_document.project_id`, `write_document.references.people`/`tasks` (element-wise), `get_document.id`, `list_documents.project_id`, `update_document.id`, `update_document.project_id` → `.uuid()`; `list_documents.limit` → `.min(1).max(100)`.
- [x] 2.3 `tools/projects.ts`: `create_project.type`, `list_projects.type`, `update_project.type` → `z.enum(projectType)`; `create_project.parent_id`, `list_projects.parent_id`, `get_project.id`, `update_project.id`, `update_project.parent_id`, `archive_project.id` → `.uuid()`.
- [x] 2.4 `tools/people.ts`: `create_person.type`, `list_people.type`, `update_person.type` → `z.enum(personType)`; `get_person.id`, `update_person.id`, `archive_person.id` → `.uuid()`.
- [x] 2.5 `tools/tasks.ts`: `create_task.status`, `list_tasks.status`, `update_task.status` → `z.enum(taskStatus)`; `create_task.project_id`/`parent_id`/`assigned_to`, `list_tasks.project_id`, `update_task.id`/`project_id`/`assigned_to`, `archive_task.id` → `.uuid()`; `list_tasks.limit` → `.min(1).max(100)`; `get_tasks.ids` → `z.string().uuid().array().max(50)` (move the imperative >50 check into the schema, keep or simplify the imperative check accordingly).
- [x] 2.6 `tools/ai_output.ts`: `create_tasks_with_output.tasks[].project_id`/`assigned_to` → `.uuid()`, `.status` → `z.enum(taskStatus)`; `tasks` array → `.min(1)` (aligns with the imperative empty check).
- [x] 2.7 `tools/queries.ts`: `get_project_summary.id`, `get_note_snapshot.id`/`reference_id` → `.uuid()`; `get_recent_activity.days` → bounded `.max()`.

## 3. ilike escaping

- [x] 3.1 `repositories/supabase-document-repository.ts`: apply `escapeLikePattern` to `filters.titleContains` and `filters.search` before building the `%…%` `ilike` patterns (lines ~55, 57); ensure the pattern uses the default `\` escape char.

## 4. Unified conventions: not-found, zero-field, affected-row

- [x] 4.1 Get-by-id not-found: change `get_project` (`projects.ts`) and `get_person` (`people.ts`) from `errorResult` to a non-error `textResult("… not found: <id>")`, matching `get_thought_by_id`/`get_document`; verify `get_tasks` already reports missing ids as non-error data.
- [x] 4.2 Zero-field update: change `update_task`, `update_project`, `update_person` from `textResult("No fields to update.")` to `errorResult("No fields to update")`, matching `update_thought`/`update_document`.
- [x] 4.3 Affected-row verification in repositories: make each `update` method (`supabase-task-repository.ts`, `supabase-project-repository.ts`, `supabase-person-repository.ts`) return the updated row via `.select().maybeSingle()` (or expose row count) so the caller can detect zero matches. Keep `supabase-thought-repository.ts`/`supabase-document-repository.ts` behavior (they pre-check via `findForUpdate`) but ensure they too surface not-found consistently.
- [x] 4.4 Update tools report not-found: `update_task`, `update_project`, `update_person` return non-error "no <entity> with id …" when the repository update matched zero rows, instead of reporting success.

## 5. thought_stats SQL RPC

- [x] 5.1 New append-only migration `supabase/migrations/20260706000001_thought_stats_rpc.sql`: create a `thought_stats(p_project_id uuid default null)` SQL function returning the aggregates the tool currently computes (total active, counts by type, by reliability/topics/people as applicable — match current output shape). `SECURITY INVOKER`; `REVOKE EXECUTE … FROM anon, authenticated`; `GRANT EXECUTE … TO service_role`.
- [x] 5.2 Wire the tool/repository to call `supabase.rpc("thought_stats", …)` instead of `listForStats` client-side aggregation; keep the tool's formatted output identical. Remove `listForStats` (and its now-unused row type) if nothing else uses it, or leave a documented note if retained.

## 6. Generated DB types

- [x] 6.1 Generate `supabase gen types typescript --local` into `supabase/functions/terrestrial-brain-mcp/database.types.ts` (against the local stack with the new migration applied); commit the file.
- [x] 6.2 Type the client `SupabaseClient<Database>` at construction (`index.ts:59`) and in the repository/tool signatures that accept the client.
- [x] 6.3 Delete hand-written inline row shapes now covered by generated types (`tools/thoughts.ts` `ThoughtUpdateFields`/inline `.map` shapes/`ExistingThought`; the "hand-written until generated types land — Step 24" row interfaces across `repositories/*-repository.ts`), replacing them with `Database`-derived types (`Tables<'…'>` / `Row` helpers) where practical. Keep domain-specific param/filter interfaces that are not raw DB rows.
- [x] 6.4 Wire type regeneration into the dev workflow: add a `gen:types` step to `deno.json` tasks and/or `scripts/dev.sh` so types refresh after migrations; document it (README dev section).

## 7. Testing & Verification

- [x] 7.1 Unit test `escapeLikePattern` (`tests/unit/`): each metacharacter, backslash-first ordering, empty string, no-op on plain text.
- [x] 7.2 Integration (`tests/integration/`, `TB_AI_PROVIDER=fake`): invalid enum (`status`/`type`/`reliability`) → validation error + zero DB effect; non-UUID id → validation error; over-`max` limit → validation error; `get_tasks` >50 ids → error.
- [x] 7.3 Integration: unified not-found for each get-by-id tool (valid nonexistent UUID → non-error "not found"); nonexistent-UUID update (task/project/person) → not-found and no row created (write failing-first, per the affected-row bug); zero-field update → "No fields to update".
- [x] 7.4 Integration: document search containing `%` matches only literal `%`, not every document (seed 2 docs, one with `%`); ordinary substring search still works.
- [x] 7.5 Integration: `thought_stats` returns aggregates via the RPC that equal a direct-DB count (seed known rows); confirm the migration grants EXECUTE to service_role only.
- [x] 7.6 Update existing integration tests that asserted the old inconsistent semantics (get_project/get_person not-found shape, task/project/person zero-field response) to the new contract; note each change.
- [x] 7.7 GATE 2b mutation check: confirm removing a `.uuid()`/`.max()`/`z.enum`/escaping/affected-row line reddens at least one test.
- [x] 7.8 Run full suite green: `deno task test` (0 fail, 0 skip) and `cd obsidian-plugin && npm test && npm run build`; run `deno lint` and `deno fmt --check`; paste the passing summary lines.
