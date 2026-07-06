## Context

Two GDPR data-lifecycle gaps (finding X7):

1. **`function_call_logs` grows forever.** The table (`migrations/20260404000002`) stores JSON-serialized tool inputs — which include personal note content — plus client IP addresses, with no retention window, no size cap, and only a `called_at desc` index (no `(function_name, called_at)` composite). There is no purge path.

2. **No erasure pathway.** The plugin syncs notes into `note_snapshots` (keyed by `reference_id` = vault-relative path) and derives `thoughts` (FK `thoughts.note_snapshot_id → note_snapshots.id ON DELETE SET NULL`). When a note is deleted in the vault, `syncEngine.handleFileDelete` only drops the local content hash; the snapshot and thoughts persist in the backend indefinitely. There is no user-facing way to erase a specific note's backend data.

Current architecture the change plugs into:
- All DB access is behind repositories (`NoteSnapshotRepository`, `ThoughtRepository`, …). Tools are registered in `createMcpServer` (`index.ts`) and HTTP routes in the `HTTP_ROUTES` table.
- The plugin depends on `TerrestrialBrainApiClient` (interface) / `HttpTerrestrialBrainClient` (impl); the sync engine depends on injected ports. Vault lifecycle events are wired in `main.ts` and handled in `syncEngine.ts`.
- Logging is centralized in `logger.ts` (`createFunctionCallLogger`), which serializes `input` before insert.
- Migrations are append-only.

## Goals / Non-Goals

**Goals:**
- Bound `function_call_logs` retention: a purge function + best-effort schedule, a `(function_name, called_at)` index, `CHECK` constraints on `function_type`/`function_name`, and a write-time cap on stored `input`.
- Provide a real erasure pathway: a backend `forget_note` MCP tool + `/forget-note` HTTP route that removes a note's snapshot and derived thoughts, invoked automatically on vault-delete and manually via a plugin command.
- Disclose the data flow (what leaves the vault, where it goes, how to erase) in the plugin settings and README.

**Non-Goals:**
- Erasing tasks/projects/people derived from a note (shared entities, not 1:1 with a note).
- A GDPR data-export feature.
- Retention windows on domain tables other than `function_call_logs`.
- Changing the routine soft-archive convention for normal ingest/reconciliation.

## Decisions

### D1 — `forget_note` HARD-deletes the snapshot + its thoughts (not soft-archive)

The system's routine convention is soft-archive (`archived_at`), chosen so an LLM plan can never permanently destroy data (Step 4). `forget_note` is the deliberate exception: it is **user-initiated, explicit, and its entire purpose is erasure**. GDPR's right-to-erasure means the data must actually be gone, not flagged `archived_at` while the row (and the personal content it holds) still sits in the database. So `forget_note` hard-deletes.

**Tension documented:** soft-archive protects against *accidental/automated* loss; hard-delete here is *intentional/manual* loss the user asked for. The two coexist because the trigger is different — an LLM reconciliation plan can only ever archive (Step 4 guarantees this), while a human explicitly forgetting a note erases. `forget_note` is never called from an LLM path.

**Scope:** delete `thoughts WHERE note_snapshot_id = <snapshot.id>`, then delete the `note_snapshots` row. Tasks/projects/people are out of scope (Non-Goal) and this is stated in the data-flow disclosure. Order matters: delete thoughts first, then the snapshot, so a crash between the two leaves thoughts already gone with the snapshot still resolvable for retry (recoverable — re-running `forget_note` finishes the job). The reverse order would orphan thoughts (FK sets their `note_snapshot_id` to NULL) and lose the link needed to find them.

*Alternative considered:* soft-archive + a later purge job. Rejected — it delays erasure past the user's request and complicates "is it really gone?"; erasure should be immediate and verifiable.

### D2 — `forget_note` is idempotent; unknown `reference_id` is success

Vault-delete fires for notes that were never synced (excluded, or created-and-deleted within the debounce window). A `forget_note` for a `reference_id` with no snapshot must return success ("nothing to forget"), not an error — otherwise every delete of an unsynced note surfaces a spurious failure Notice. Re-running `forget_note` on an already-forgotten note is likewise a no-op success. This satisfies the "runs twice" idempotency rule.

### D3 — Purge via a SQL function + best-effort `pg_cron`, callable directly

Add `purge_function_call_logs(retention_days integer default 90) RETURNS integer` (SECURITY DEFINER, execute granted to `service_role` only, matching the Step 1 lockdown) that deletes rows with `called_at < now() - retention_days` and returns the count deleted.

Scheduling: attempt `cron.schedule(...)` inside a guarded `DO` block that swallows the exception if `pg_cron` cannot load (locally it may not be in `shared_preload_libraries`; CI uses a fresh `supabase start`). The migration therefore never fails on pg_cron absence. Where pg_cron is present (production Supabase), a daily purge is scheduled. The retention window default is 90 days; production overrides by re-scheduling with a different argument.

*Alternative considered:* a DB trigger deleting old rows on each insert. Rejected — per-insert scans add latency to the hot logging path. *Alternative:* rely solely on pg_cron. Rejected — not guaranteed available locally/CI, and the function must be directly testable. Testing calls the RPC directly (deterministic, pg_cron-independent).

### D4 — Retention window is configurable; env var documents intent

`TB_LOG_RETENTION_DAYS` (default 90) documents the policy for operators. The scheduled job uses the migration-time default (90); operators adjust by re-scheduling. The env var is read where a manual/edge-invoked purge is wired, and documented in README. (No cold-start purge on every request — that would add DB load to the request path; scheduling owns cadence.)

### D5 — `input` truncation at write time in `logger.ts`

Cap serialized `input` at a bounded length (constant `MAX_LOGGED_INPUT_CHARS`, e.g. 10 000) before insert. If longer, store the prefix plus a `…[truncated N chars]` marker. This bounds how much personal content the log can accumulate per row (data minimization) and is enforced in one place (`logCall`). A DB-side `CHECK`/trigger was rejected — truncation (not rejection) is the desired behavior, and doing it app-side keeps the marker semantics clear and avoids failing a log insert (logging must never break the response path).

### D6 — `CHECK` constraints on `function_type` / `function_name`

`function_type` is only ever `'mcp'` or `'http'` (set by code, never user input) → `CHECK (function_type IN ('mcp','http'))`. `function_name` must be non-empty and bounded → `CHECK (char_length(function_name) BETWEEN 1 AND 100)`. These are integrity guards catching a future code bug that writes a malformed row; existing rows already conform.

### D7 — Repository seam for deletion

`NoteSnapshotRepository` gains `findIdByReference(referenceId)` (or reuse a lookup) and `deleteByReference(referenceId)`; `ThoughtRepository` gains `deleteByNoteSnapshot(snapshotId)`. All DB access stays behind repositories (no inline `supabase.from`). The `forget_note` tool composes: resolve snapshot id → delete thoughts → delete snapshot. Both delete methods are also exposed to the `/forget-note` HTTP route context.

### D8 — Plugin wiring

- `apiClient`: add `forgetNote(noteId)` → POST `/forget-note` `{ note_id }`.
- `syncEngine.handleFileDelete`: after clearing the timer/hash, call `forgetNote(file.path)` (best-effort; a failure surfaces a Notice but does not throw). Only attempt for eligible (non-excluded) markdown files to avoid needless calls.
- New command **"Forget this note in Terrestrial Brain"** (active-file → `forgetNote(path)`), so a user can erase a note's backend data without deleting the vault file.
- Settings description + README gain the data-flow disclosure.

### Test Strategy

- **Integration (Deno, real stack):** `forget_note`/`/forget-note` happy path (snapshot + thoughts gone), idempotency (unknown ref → success, double-forget → success), and that unrelated notes' data is untouched. `purge_function_call_logs` RPC: seed old + recent rows, call, assert only old deleted and count returned. Constraint tests: inserting an invalid `function_type` is rejected. These run against the local stack with `TB_AI_PROVIDER=fake` (no live LLM needed for forget/purge paths).
- **Unit (plugin vitest):** `apiClient.forgetNote` builds the right request (fetch mocked at boundary); `syncEngine.handleFileDelete` calls `forgetNote` for eligible files and surfaces a Notice on failure without throwing; the command invokes `forgetNote` with the active file path.
- **Unit (Deno):** `logger` truncation — an over-long input is stored truncated with the marker.
- **Mutation check (GATE 2b):** deleting the thought-delete line leaves thoughts present → integration test fails; removing truncation → logger unit test fails.

### User error scenarios

- **Delete an unsynced/excluded note:** `forget_note` returns success (nothing to forget) — no spurious failure Notice (D2).
- **Double delete / re-run command:** idempotent success (D2).
- **"Forget note" command with no active file / non-markdown:** command guards and shows a Notice ("Open a note first"), makes no call.
- **Backend unreachable during vault-delete forget:** Notice surfaces the failure; the local hash is still dropped so a later re-sync/forget can reconcile (does not throw / crash the delete handler).
- **Malformed `note_id` (empty):** route validates `note_id` is a non-empty string → 400 with a clear message.

### Security analysis

- `/forget-note` and `forget_note` sit behind the same `x-brain-key` auth as every other route — no new unauthenticated surface. Recorded in `ThreatModel.md`.
- Erasure is destructive: mitigated by (a) auth gate, (b) scope limited to a single `reference_id`'s snapshot + thoughts (no bulk/wildcard delete), (c) idempotent design so a replay does no extra damage.
- `purge_function_call_logs` is SECURITY DEFINER but EXECUTE is service_role-only (Step 1 convention) — anon cannot call it. Its only effect is deleting *old logs*, not user content.
- Input truncation reduces the volume of personal data retained in logs (data minimization).
- No secrets added; retention days is non-sensitive config.

## Risks / Trade-offs

- **[pg_cron absent locally/CI → no scheduled purge]** → Mitigation: purge function exists and is directly callable/testable; scheduling is best-effort and guarded so the migration still succeeds; production Supabase has pg_cron.
- **[Hard-delete is irreversible]** → Mitigation: gated by explicit user action + auth; scoped to one note; never reachable from an LLM path (contrast Step 4's archive-only guarantee).
- **[Vault-delete forget adds a network call per delete]** → Mitigation: only for eligible markdown files; best-effort, non-blocking, failure is a Notice not a crash.
- **[Truncation could drop content needed for debugging a log entry]** → Mitigation: 10 000-char cap is generous for a log; the marker records how much was dropped; the full note still lives in `note_snapshots` until erased.

## Migration Plan

1. Ship one append-only migration: `(function_name, called_at)` index, `CHECK` constraints, `purge_function_call_logs` function + grants, guarded `pg_cron` schedule.
2. Deploy the edge function (new tool/route + logger truncation) and the plugin build.
3. Rollback: the migration is additive (index/constraints/function) — reverting code leaves them harmless. The forget pathway is opt-in per action; no data backfill.

## Open Questions

- None blocking. Production retention window (90 vs 30/60) is an operator policy choice; 90 is the documented default and adjustable by re-scheduling.
