## Context

Terrestrial Brain soft-archives thoughts everywhere except two paths that issue a real SQL `DELETE`:

1. **`handleIngestNote` reconciliation** (`tools/thoughts.ts:1057-1063`). When a note that already has thoughts is re-ingested, an LLM (gpt-4o-mini) returns a reconciliation plan with `keep`/`update`/`add`/`delete` lists. The `delete` list is executed as `supabase.from("thoughts").delete().eq("id", id)`. A hallucinated ID — or an ID for a thought the user still wants — is destroyed permanently.

2. **`update_document` content change** (`tools/documents.ts:307-346`). On a content change it (a) hard-deletes every thought whose `metadata.references.documents` contains the doc ID, (b) re-extracts references, then (c) updates the document. The delete happens **before** the update and its error is only `console.error`'d; if the update then fails, the thoughts are gone and the stored content is stale.

Meanwhile `archive_thought` (`tools/thoughts.ts:797`) sets `archived_at = now()` and its description promises archived thoughts "are not deleted and can still be retrieved with include_archived." The `archived_at` column already exists and the reconciliation fetch already filters `.is("archived_at", null)` (`thoughts.ts:905`), so archiving is fully consistent with existing behavior and needs no migration.

## Goals / Non-Goals

**Goals:**
- No code path can permanently destroy a thought as a side effect of an LLM plan or a document update.
- `update_document` never leaves thoughts orphaned relative to document content: update succeeds first, cleanup follows.
- A cleanup failure is visible to the caller, not swallowed.

**Non-Goals:**
- Undo/restore UX, archived-thought GC/retention (Step 25), reconciliation-prompt changes, or a Postgres-transaction/RPC rewrite of `update_document`.

## Decisions

**D1 — Reconciliation `delete` list becomes a soft archive.**
Replace `.delete().eq("id", id)` with `.update({ archived_at: new Date().toISOString() }).eq("id", id)` in the reconciliation loop. The surrounding `Promise.allSettled` accounting and the `deleted++` counter / "removed" wording are kept (from the user's perspective the thought is still removed from the active note), so the summary message is unchanged. Chose reuse of the existing `archived_at` convention over a new "trash" table (which would duplicate the retrieval path `include_archived` already provides) or over passing the plan through a confirmation step (out of scope, and the reconciliation path is non-interactive).

**D2 — `update_document`: update first, then archive.**
Reorder to: build `updates` (including re-extracted references) → `UPDATE documents` → only if that succeeds, archive the linked thoughts via `.update({ archived_at })...contains("metadata", {references:{documents:[id]}})`. Re-extraction stays before the update because its result feeds `updates.references`; only the destructive thought-cleanup moves after. This guarantees a failed update leaves thoughts untouched. Chose ordering + soft-archive over a single multi-statement transaction because Supabase edge tools don't wrap multiple client calls in one transaction without an RPC, and an RPC rewrite is disproportionate to a wording+ordering fix (recorded as a Non-goal).

**D3 — Surface cleanup failure in the result.**
If the post-update archive returns an error, append a warning to the returned text (e.g. `" (warning: thought cleanup failed — some stale thoughts may remain active: <message>)"`) rather than `console.error`-and-continue. The document update already succeeded, so the tool still reports success, but the caller learns cleanup was partial. Chose a warning suffix (matching the existing `contentWarning` pattern already in this function) over returning `isError: true` (which would misreport a successful document update as a failure).

**D4 — Return wording reflects archiving.**
The `thoughts_required` line changes "Previous thoughts were deleted" → "Previous thoughts were archived" so the AI-facing text matches reality.

### User error scenarios

- **LLM returns a `delete` ID that doesn't exist / is already archived** → the `UPDATE ... WHERE id = ` simply matches zero rows; no error, no data lost. (Previously a `DELETE` of a hallucinated ID was a silent no-op too, but a *correct-looking wrong* ID destroyed a real thought — now it only archives, which is reversible.)
- **User re-ingests a note, LLM over-aggressively marks a still-relevant thought for deletion** → thought is archived, not destroyed; retrievable via `include_archived`; excluded from the next reconciliation fetch so it won't resurface as a spurious "existing" thought.
- **User updates a document with new content and the DB update fails** (constraint, connectivity) → thoughts are NOT touched; the tool returns `isError: true` and the old thoughts + old content remain a consistent pair.
- **Update succeeds but thought cleanup fails** → document is updated, warning is surfaced; stale thoughts remain *active* (not lost) and can be re-cleaned on a subsequent update or archived manually.

### Security analysis

Threats are documented in `ThreatModel.md`. Summary:
- **T1 — LLM-driven destructive action (integrity/availability).** A compromised or hallucinating model could weaponize the `delete` list to erase knowledge. **Mitigation:** soft-archive makes every LLM-directed removal reversible; no code path exposes a real `DELETE` to model output.
- **T2 — Partial-failure data corruption.** Non-atomic delete-then-update could leave the store internally inconsistent (content references thoughts that no longer exist, or vice-versa). **Mitigation:** update-first ordering + failure surfacing keeps document/thought state consistent and observable.
- No new inputs, endpoints, auth surface, or PII flows are introduced; access control (anon lockout / shared-key auth) is unchanged.

### Test Strategy

Both fixes are exercised through the running MCP edge function against the local Supabase stack, so the primary layer is the **Deno integration suite** (`tests/integration/`) — no mocks on the code path, matching the owner's integration-test rule.

- **Bug replication (failing-first):**
  - `thoughts.test.ts`: ingest a note, re-ingest with content that drops a thought's topic so reconciliation marks it for removal; assert the removed thought row still **exists** with `archived_at` set (queried via the service-role REST API with `include_archived`-style direct select). Against current code the row is gone → test fails first.
  - `documents.test.ts`: create a document + linked thoughts, `update_document` with new content; assert the old thoughts still exist with `archived_at` set (not deleted). Second test: force the document update to fail (e.g. update with an invalid `project_id` FK) and assert the linked thoughts are **untouched** (still active). Against current code the pre-update delete already removed them → test fails first.
- **Unit layer:** none required; the logic is thin glue over the DB client and is best verified end-to-end.
- **Plugin vitest:** unaffected (no plugin change), but the full suite still runs as a gate.

## Risks / Trade-offs

- [Archived thoughts accumulate over time] → Acceptable; retention/GC is explicitly Step 25's scope. The reconciliation fetch and default listing already exclude archived rows, so accumulation doesn't degrade behavior, only storage.
- [Update-first means a rare "update ok, cleanup failed" state leaves stale active thoughts] → Mitigated by surfacing the warning (D3); the state is consistent-enough (nothing lost) and self-heals on the next update. Preferable to the old "cleanup ok, update failed → data lost" state.
- [Simulating a document-update failure in an integration test requires a real failure trigger] → Use a foreign-key violation (invalid `project_id`) which the DB rejects deterministically; documented in the test.

## Migration Plan

No schema migration. Pure edge-function code change; deploy is a standard function redeploy. Rollback = revert the two files (no data shape changed; any thoughts archived under the new behavior remain valid `archived_at` rows under the old code).
