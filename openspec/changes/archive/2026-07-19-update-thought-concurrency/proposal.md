# update_thought Optimistic Concurrency

## Why

`update_thought` does a read-modify-write on `metadata` (fetch → merge references in memory → write the whole object back keyed only on `id`). The tool is explicitly multi-actor (`actor: LLM | user | sync` — the console, connectors, and the model all drive this path), so two interleaved updates each read the same snapshot and the second write clobbers the first's `references.projects` / `references.documents` wholesale (remediation plan Step 17, TOOL-6). This is the binding directive's "Interleaves? → use optimistic concurrency where last-write-wins would lose data" case, currently unanswered.

## What Changes

- `ThoughtRepository.findForUpdate` also selects `updated_at` (trigger-maintained on every thoughts write — a ready-made etag; no new column, no migration).
- `ThoughtRepository.update` gains an optional `options: { expectedUpdatedAt?: string }` parameter. When provided, the implementation adds `.eq("updated_at", expectedUpdatedAt)` to the update filter and returns whether a row actually matched (via `.select("id")`), so a stale snapshot matches zero rows instead of overwriting.
- The `update_thought` handler passes the `updated_at` it read and returns an explicit "concurrent edit — the thought changed since it was read; re-read and retry" error when no row matched. The handler is extracted (`handleUpdateThought`) so it runs against fake repositories in unit tests, following the established `handleListTasks` / `handleGetProject` pattern.
- Other `update` callers (`executeReconciliationPlan`, extractor merge path) are unchanged — they intentionally rewrite content wholesale from the source note (sync semantics), and pass no guard.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `update-thought` (`openspec/specs/update-thought/spec.md`): new requirement — concurrent-edit detection on the read-modify-write path (stale snapshot → explicit retryable error, no silent last-write-wins).
- `thought-repository` (`openspec/specs/thought-repository/spec.md`): new requirement — `update` supports an optional optimistic-concurrency guard keyed on `updated_at` and reports whether a row matched.

## Non-goals

- No `version` column, no migration — `updated_at` (trigger-maintained, microsecond precision) is sufficient and already exists.
- No retry loop inside the server — the caller (model/console) re-reads and retries; the error message says exactly that.
- No concurrency guard on the reconciliation/sync bulk path (wholesale rewrite from the note is its documented semantic).
- No jsonb_set RPC (alternative in the finding) — the etag approach is smaller and also protects `content`/top-level fields, not just references.

## Impact

- `supabase/functions/terrestrial-brain-mcp/repositories/thought-repository.ts` (interface + `ThoughtForUpdateRow`)
- `supabase/functions/terrestrial-brain-mcp/repositories/supabase-thought-repository.ts` (`findForUpdate`, `update`)
- `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` (`update_thought` handler, extracted as `handleUpdateThought`)
- Tests: new unit tests (fake repository) + integration test against the real stack proving a stale-snapshot update matches zero rows. Existing fakes implementing `ThoughtRepository` keep compiling (the new parameter is optional; the return type change is additive).
- No API-contract change for the plugin/HTTP surface; the MCP tool gains one new error message.
