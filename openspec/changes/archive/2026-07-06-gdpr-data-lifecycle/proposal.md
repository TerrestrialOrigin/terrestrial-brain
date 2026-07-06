## Why

The system currently retains personal data indefinitely and offers no way to erase it. `function_call_logs` stores full tool inputs (personal note content) plus client IP addresses forever, with no retention window, no size cap, and no index for time-bounded cleanup (finding X7, `migrations/20260404000002`). Separately, the Obsidian plugin syncs every note by default but has no deletion pathway: deleting a vault note only forgets the local content hash (`syncEngine.handleFileDelete`), leaving the note snapshot and its derived thoughts in the backend forever. Both gaps are GDPR data-lifecycle failures — the system cannot honour retention limits or a right-to-erasure request.

## What Changes

- **Log retention (`function_call_logs`):**
  - Add a `(function_name, called_at)` index to support time-bounded purge and per-function queries.
  - Add `CHECK` constraints on `function_type` (must be `'mcp'` or `'http'`) and `function_name` (non-empty, bounded length).
  - Cap the stored `input` payload at write time to a bounded size (the logger truncates oversized inputs before insert, with a marker).
  - Add a `purge_function_call_logs(retention_days)` SQL function that deletes rows older than a configurable window, scheduled via `pg_cron` where available (best-effort) and invokable directly; default retention window is configurable (`TB_LOG_RETENTION_DAYS`, default 90 days).
  - Document the retention policy in README.
- **Backend deletion pathway (right to erasure):**
  - New MCP tool `forget_note` and matching HTTP route `/forget-note` that, given a note's `reference_id`, **hard-deletes** the corresponding `note_snapshots` row and the `thoughts` derived from it (GDPR erasure; see design.md for the archive-vs-delete decision and its tension with the soft-archive convention).
  - Plugin wiring: a vault-delete of an eligible note triggers a backend forget call, and an explicit command **"Forget this note in Terrestrial Brain"** lets the user erase a specific note on demand.
- **Data-flow disclosure:** State what leaves the vault, where it goes, and how to erase it, in both the plugin settings description and the README.

## Capabilities

### New Capabilities
- `note-deletion`: The end-to-end erasure pathway — a backend `forget_note` MCP tool + `/forget-note` HTTP route that hard-deletes a note's snapshot and derived thoughts, plus the plugin command and vault-delete wiring that invoke it, and the user-facing data-flow disclosure.

### Modified Capabilities
- `function-call-logging` (`openspec/specs/function-call-logging/spec.md`): add a retention window and purge function, a `(function_name, called_at)` index, `CHECK` constraints on `function_type`/`function_name`, and a bounded `input` size enforced at write time.

## Non-goals

- Erasing tasks, projects, or people derived from a note. These are shared knowledge-base entities not tied one-to-one to a single note; `forget_note` scopes erasure to the note snapshot and its thoughts only (documented in the data-flow disclosure).
- Changing the existing soft-archive (`archived_at`) convention for the normal ingest/reconciliation flow — `forget_note` is a deliberate, user-initiated hard-delete exception, not a change to routine deletes.
- A full GDPR data-export ("download my data") feature — out of scope for this change.
- Retention/purge of `note_snapshots`, `thoughts`, `ai_output`, or other domain tables — only `function_call_logs` gets a retention window here.

## Impact

- **Migrations:** one new append-only migration adding the index, check constraints, purge function, and best-effort `pg_cron` schedule.
- **MCP server (`supabase/functions/terrestrial-brain-mcp/`):** new `forget_note` tool + `/forget-note` HTTP route; `logger.ts` input truncation; `NoteSnapshotRepository` / `ThoughtRepository` gain the delete-by-reference capability.
- **Plugin (`obsidian-plugin/src/`):** `apiClient` gains a `forgetNote` call; `syncEngine.handleFileDelete` invokes it; new "Forget this note in Terrestrial Brain" command; settings description updated.
- **Docs:** README retention policy + data-flow section; plugin settings description.
- **Env:** new optional `TB_LOG_RETENTION_DAYS` (default 90).
