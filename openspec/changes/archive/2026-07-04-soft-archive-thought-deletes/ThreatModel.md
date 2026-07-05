# Threat Model — soft-archive-thought-deletes

Scope: the two destructive code paths being changed (`handleIngestNote` reconciliation and `update_document` thought cleanup). No new inputs, endpoints, auth surface, or data flows are introduced by this change.

## T1 — LLM-driven destructive action (integrity / availability)

**Description:** `handleIngestNote` feeds an LLM (gpt-4o-mini) reconciliation plan directly into a SQL `DELETE`. A hallucinating, prompt-injected, or otherwise wrong model output can permanently erase a user's captured knowledge with no undo. This is the highest-severity issue: model output must never map to an irreversible destructive DB operation.

**Attack / failure vectors:**
- Model hallucinates IDs or over-eagerly classifies still-relevant thoughts into `delete`.
- Prompt injection via note content steers the model to mark unrelated thoughts for deletion.
- Model regression/outage returns malformed plans.

**Mitigation (this change):** the `delete` list is executed as a soft archive (`archived_at = now()`). Every LLM-directed removal is reversible and retrievable (`include_archived`); no code path exposes a hard `DELETE` to model output. Archived rows are excluded from the reconciliation fetch, so an over-archived thought does not resurface as a spurious "existing" thought.

**Residual risk:** an LLM can still archive a thought the user wanted active; impact is now a reversible visibility change, not data loss.

## T2 — Partial-failure data corruption (integrity)

**Description:** `update_document` deletes linked thoughts *before* updating the document, non-atomically, and swallows the delete error. A failed update leaves the document content stale while its thoughts are already destroyed — an internally inconsistent, unrecoverable state that is also invisible to the caller.

**Attack / failure vectors:**
- DB update fails after the delete (constraint violation, connectivity, invalid `project_id` FK).
- Thought-cleanup delete partially fails and is silently ignored.

**Mitigation (this change):** reorder to update-document-first, then soft-archive linked thoughts only on update success; surface a cleanup failure as a warning in the tool result. A failed update now leaves thoughts untouched (document + thoughts stay a consistent pair); a failed cleanup is observable and self-heals on the next update.

**Residual risk:** rare "update ok, cleanup failed" leaves stale *active* (not lost) thoughts; surfaced to the caller and reversible.

## Out of scope

- Confirmation/approval gating of reconciliation (path is non-interactive).
- Archived-thought retention/GC (Step 25).
- Multi-statement transactional atomicity via RPC (disproportionate to this fix; recorded as a Non-goal in design.md).
