## 1. Log retention migration (function_call_logs)

- [x] 1.1 New append-only migration `supabase/migrations/<ts>_function_call_logs_retention.sql`: add `(function_name, called_at)` index; add `CHECK (function_type IN ('mcp','http'))` and `CHECK (char_length(function_name) BETWEEN 1 AND 100)`.
- [x] 1.2 Same migration: `purge_function_call_logs(retention_days integer default 90) RETURNS integer` (SECURITY DEFINER); revoke EXECUTE from public/anon/authenticated, grant to service_role only.
- [x] 1.3 Same migration: best-effort `pg_cron` daily schedule inside a guarded `DO` block that swallows the exception if pg_cron cannot load (migration must still succeed).
- [x] 1.4 Apply the migration to the local stack (`supabase db reset` or `supabase migration up`) and confirm the function + index + constraints exist.

## 2. Logger input truncation

- [x] 2.1 Add `MAX_LOGGED_INPUT_CHARS` constant and truncation in `logger.ts` `logCall`: cap serialized `input`, appending a `…[truncated N chars]` marker; never let truncation throw.
- [x] 2.2 Deno unit test: over-long input stored truncated + marker; within-cap input stored unchanged.

## 3. Repository deletion seams

- [x] 3.1 `ThoughtRepository`: add `deleteByNoteSnapshot(snapshotId): RepoResult<number>` (hard delete, returns count); implement in `SupabaseThoughtRepository`.
- [x] 3.2 `NoteSnapshotRepository`: add `findIdByReference(referenceId): RepoResult<{ id: string } | null>` and `deleteByReference(referenceId): RepoResult<void>`; implement in `SupabaseNoteSnapshotRepository`.

## 4. Backend forget-note tool + HTTP route

- [x] 4.1 Add a `forget_note` MCP tool (new `tools/forget_note.ts` or existing thoughts tool module): resolve snapshot id → delete thoughts → delete snapshot; idempotent success when no snapshot; return a count summary. Wire `noteSnapshotRepository` into `createMcpServer` repos.
- [x] 4.2 Add `/forget-note` to `HTTP_ROUTES` in `index.ts`: validate non-empty `note_id` (400 otherwise), call the shared forget logic, return `{ success, message }`.
- [x] 4.3 Factor the forget logic into one transport-neutral function shared by the tool and the route (no duplication).

## 5. Plugin wiring

- [x] 5.1 `apiClient`: add `forgetNote(noteId)` to the `TerrestrialBrainApiClient` interface + `HttpTerrestrialBrainClient` (POST `/forget-note` `{ note_id }`).
- [x] 5.2 `syncEngine.handleFileDelete`: for eligible markdown files, call `forgetNote(file.path)` best-effort — surface a Notice on failure, never throw, still drop the local hash. Inject the client/notifier as needed via ports.
- [x] 5.3 `main.ts`: register command "Forget this note in Terrestrial Brain" → forget the active markdown note; Notice + no call when no active note.

## 6. Data-flow disclosure & docs

- [x] 6.1 README: retention policy section (`function_call_logs` purge window, `TB_LOG_RETENTION_DAYS`) + data-flow section (what leaves the vault, where stored, how to erase).
- [x] 6.2 Plugin settings description: add the data-flow / erasure disclosure.
- [x] 6.3 `ThreatModel.md`: note the `/forget-note` destructive surface + auth/scope/idempotency mitigations.

## 7. Tests & Verification

- [x] 7.1 Integration (Deno): `forget_note`/`/forget-note` happy path erases snapshot + thoughts; unrelated data untouched; missing `note_id` → 400; no key → 401.
- [x] 7.2 Integration (Deno): idempotency — unknown ref → success, double-forget → success.
- [x] 7.3 Integration (Deno): `purge_function_call_logs` seed old+recent → only old deleted, count returned; invalid `function_type` insert rejected.
- [x] 7.4 Plugin vitest: `forgetNote` request shape; `handleFileDelete` forget-on-delete + failure Notice without throw; forget command behavior incl. no-active-note guard.
- [x] 7.5 Run full suites — `deno task test` (with `TB_AI_PROVIDER=fake`) and `cd obsidian-plugin && npm test && npm run build`; zero failures, zero skips.
- [x] 7.6 `/opsx:verify`, then `/opsx:archive`; check off Step 25 in `codeEval/Fable20260704-fix-plan.md`.
