## Why

Two code paths permanently `DELETE` thoughts, while every other part of the system soft-archives via `archived_at` (and `archive_thought` explicitly promises retrievability). `handleIngestNote` executes an LLM-produced `delete` list as a real `DELETE`, so a single hallucinated ID irreversibly destroys a user's captured knowledge. `update_document` hard-deletes referencing thoughts *before* updating the document and only `console.error`s a cleanup failure — if the update then fails, the thoughts are already gone and the document content is stale, with no signal to the caller. This is silent, unrecoverable data loss (findings C2 and C3).

## What Changes

- `handleIngestNote` reconciliation SHALL soft-archive (set `archived_at = now()`) the thoughts in the LLM plan's `delete` list instead of issuing a real `DELETE`. A hallucinated or wrong ID can no longer permanently destroy data; archived thoughts remain retrievable and are excluded from the reconciliation fetch (which already filters `archived_at IS NULL`).
- `update_document` (on content change) SHALL:
  - soft-archive referencing thoughts instead of hard-deleting them;
  - update the document **first** and archive the stale thoughts **only after** the update succeeds (so a failed update never orphans data);
  - surface a thought-cleanup failure in the tool result (a warning in the returned text) instead of swallowing it with `console.error`.
- The `update_document` return text SHALL say thoughts were "archived" (not "deleted") to match the new behavior.

No breaking changes to tool inputs/outputs beyond wording; no schema migration required (the `archived_at` column already exists and is used by `archive_thought`).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `thoughts`: `ingest_note` reconciliation SHALL archive (not delete) thoughts the plan marks for removal (`openspec/specs/thoughts/spec.md`).
- `update-document`: `update_document` thought cleanup SHALL archive (not delete) linked thoughts, SHALL run only after a successful document update, and SHALL surface cleanup failures in the result (`openspec/specs/update-document/spec.md`).

## Non-goals

- Adding an undo/restore UI or command — retrievability via the existing `include_archived` path is sufficient here.
- Changing the reconciliation LLM prompt or the extraction pipeline.
- Purging or GC of archived thoughts (retention/lifecycle is Step 25's scope).
- A Postgres-transaction/RPC rewrite of `update_document` — the ordering fix (update-then-archive) plus failure surfacing is the minimal, in-paradigm remedy; true multi-statement atomicity is out of scope.

## Impact

- Code: `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` (reconciliation delete loop, ~1057-1063), `supabase/functions/terrestrial-brain-mcp/tools/documents.ts` (`update_document`, ~307-346).
- Tests: `tests/integration/thoughts.test.ts`, `tests/integration/documents.test.ts` (failing-first bug replication + verification).
- Specs: `openspec/specs/enhanced-ingest.md`, `openspec/specs/update-document/spec.md`.
- No migration, no dependency, no API-shape change.
