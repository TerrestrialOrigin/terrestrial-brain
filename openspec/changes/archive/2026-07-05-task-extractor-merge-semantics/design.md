## Context

`TaskExtractor.extract` (`extractors/task-extractor.ts`) reconciles a note's checkboxes against the tasks already stored for that note's `reference_id`, then, for each matched (existing) task, writes an update. Three per-checkbox fields are resolved before the write:

- **`project_id`** — Phase 1: heading match → pipeline reference → batched LLM inference (`inferProjectsByContent`).
- **`due_by`** — Phase 1b: regex fast path (`extractDueDate`) → batched LLM enrichment (`inferTaskEnrichments`).
- **`assigned_to`** — Phase 1b: explicit `(assigned: X)` pattern → name substring → heading name → batched LLM enrichment.

Both LLM helpers currently return `[]` on *both* "nothing matched" and "the call failed", so the caller cannot distinguish them. In the matched-task update (Phase 2) `project_id` is written as `projectByCheckboxIndex.get(index) || null` — so an LLM failure nulls an existing association. `due_by`/`assigned_to` are only ever *set* (never written as null), so removing them from the note never clears them. Phases 2 (update), 4 (parent-link update) and 5 (archive) discard the Supabase `{ error }` result; only Phase 3 (insert) checks it.

## Goals / Non-Goals

**Goals:**
- Never overwrite an existing matched task's `project_id` (or `due_by`/`assigned_to`) with `null` because resolution was *unavailable* (LLM error, or no capability to resolve).
- One documented, consistent merge policy across all three fields.
- Detect and surface every failed Supabase write during extraction.

**Non-Goals:**
- No change to how *new* tasks (Phase 3) are created — a new task has no prior value to preserve.
- No database migration, no `due_by` type change (that is Step 9), no MCP tool-signature change.
- Not decomposing the god-function (that is Step 19) — this change keeps the phase structure, adding availability tracking and error checks.
- No retry/queue for failed writes — we report them; recovery policy is out of scope here.

## Decisions

### Decision 1: Per-field availability model — three states, not two

Each field, per checkbox, resolves to one of three states:
- **Resolved-to-value** — a concrete `project_id` / `due_by` / `assigned_to` was found.
- **Resolved-to-empty (available)** — resolution *ran and completed* and concluded there is no value (e.g. the LLM enrichment call succeeded but returned no date for this task; heading/pipeline/regex all found nothing *and* the LLM path was not needed or succeeded).
- **Unavailable** — resolution that *would have been needed* could not run to completion: the batched LLM call errored, or the capability was absent (e.g. project inference needs known projects but there are none / the guard skipped the call).

Implementation: keep the existing "resolved-to-value" maps (`projectByCheckboxIndex` now holds only positive `string` values; `dueDateByIndex`; `assignedToByIndex`) and add three `Set<number>` of *unavailable* indices (`projectUnavailable`, `dateUnavailable`, `personUnavailable`). Anything neither resolved-to-value nor unavailable is resolved-to-empty.

- `inferProjectsByContent` and `inferTaskEnrichments` change their return type to `{ ok: boolean; assignments|enrichments: [...] }`. `ok:false` on `!response.ok` or thrown error.
- Project: after the inference block, any checkbox that was queued for LLM project inference and is not positively resolved is marked `projectUnavailable` *unless* the LLM call ran and returned `ok:true` (a successful call that simply didn't assign it = resolved-to-empty). The "no known projects, guard skipped the call" case → unavailable (we could not resolve).
- Dates/people: after applying enrichments, any candidate that still needs a date/person is marked unavailable *unless* the enrichment call ran with `ok:true`. Enrichment skipped (guard false) or `ok:false` → unavailable for the still-missing fields.

**Alternative considered — preserve-only (never clear any field):** simpler, but the finding explicitly frames "removed dates/assignees are never cleared" as a bug, and preserve-only makes it impossible to remove a due date by editing the note. Rejected in favor of note-authoritative-when-available.

**Alternative considered — clear-always when not resolved:** this is essentially today's `project_id` behavior generalized; it is exactly the data-loss bug. Rejected.

### Decision 2: Merge policy for matched tasks (Phase 2)

For each of `project_id`, `due_by`, `assigned_to`, build the update column as:
- resolved-to-value → set the column to the value;
- unavailable → **omit the column** from the update object (preserve stored value);
- resolved-to-empty → set the column to `null` (clear).

`content`, `status`, `metadata`, `archived_at` keep their current unconditional behavior (content/status/metadata are always derivable from the note; archived_at is driven by checked-state).

### Decision 3: Surface write failures via `ExtractionResult.errors`

Add optional `errors?: string[]` to `ExtractionResult`. In `TaskExtractor`, capture the `{ error }` from every write (Phases 2, 4, 5 — Phase 3 already does) and push a human-readable message (task id + phase + `error.message`) into a local array returned as `result.errors`. `runExtractionPipeline` logs any `result.errors` via `console.error` so they are not silently dropped (full user-facing surfacing of extractor errors is Step 10's remit; here we stop the swallow and make failures observable + unit-assertable).

### Decision 4 (User-error scenarios)

- **User removes a due date / assignee from a checkbox and re-ingests:** with the LLM enrichment available, the field resolves-to-empty and is cleared — matching the note. This is the intended, now-consistent behavior.
- **User re-ingests while OpenRouter is down / rate-limited:** every LLM-dependent field is unavailable → all existing `project_id`/`due_by`/`assigned_to` values are preserved. No silent data loss. Write errors (if the DB is also unhappy) are surfaced.
- **User re-ingests after deleting all projects:** project inference cannot run → `project_id` preserved (not nulled). (Note: `ON DELETE SET NULL` at the DB already handles a *deleted* project row; this guards the *extraction* path from nulling on a still-valid association.)
- **User double-syncs the same unchanged note:** reconciliation matches every checkbox; fields resolve identically; updates are idempotent.

### Decision 5 (Security analysis)

No new external input surface, no new secret, no new endpoint. LLM outputs remain validated against allowlists (`validPeopleIds` / `validIds`) before use — a hallucinated id still cannot be written. The three-state model does not widen what an LLM can write; it only narrows when we *clear* a field. Preserving-on-unavailable cannot leak data across notes because resolution is per `reference_id`. No `ThreatModel.md` delta required — attack surface is unchanged.

### Decision 6 (Test Strategy)

Unit tests (Deno, `tests/unit/`) are the right layer: the behavior is a pure function of (note, known-tasks, LLM availability, DB write outcome), all injectable via a fake `ExtractionContext.supabase` and a stubbed `globalThis.fetch` (the established pattern in `tests/unit/project-extractor.test.ts`). A fake Supabase records `update`/`insert` payloads and can be told to return an `{ error }`. This exercises the *real* `TaskExtractor.extract` (GATE 2b: deleting the merge branch reddens the test). Integration coverage of the extractor via `enhanced_ingest`/`extractors` suites stays green untouched.

## Risks / Trade-offs

- [Clearing a field the user didn't intend to remove, if the LLM enrichment *succeeds* but misreads the note] → mitigated: clearing only happens on a successful (`ok:true`) resolution that is note-derived; the fast-path regex/pattern still win first, and the risk is symmetric with today's set-on-success behavior.
- [Fake Supabase in unit tests could drift from the real client's chained-builder shape] → mitigated by keeping the fake minimal (only the `from().update().eq()` / `from().insert().select().single()` chains the extractor actually calls) and by the untouched integration suite catching real-shape regressions.
- [`errors` field is only logged, not shown to the user yet] → acknowledged; Step 10 owns end-to-end silent-failure surfacing. This change stops the swallow and makes failures observable, which is the Step 8 scope.

## Migration Plan

Pure code change; deploy with the normal function deploy. Rollback is a straight revert — no schema or data migration to undo.

## Open Questions

None. Merge policy (note-authoritative-when-available, preserve-on-unavailable) is decided above and encoded in the delta spec scenarios.
